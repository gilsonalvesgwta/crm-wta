// Agente do serviço "backup": faz as cópias (banco + arquivos), executa a fila
// de pedidos da Plataforma e restaura (o banco inteiro ou uma empresa).
// Roda com o usuário postgres do banco do CRM; a API não tem essa senha.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, chown, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import {
  BACKUP_NAME, beatFile, jobsDir, manifestFile, stamp, uploadsDir, type BackupKind, type Job, type Manifest,
} from './format.js';

export type AgentOptions = {
  backupDir: string;
  filesDir: string;
  database: string;
  migrateScript: string;
  /** Dono dos arquivos (usuário "node" da imagem), para a API ler e escrever na pasta. */
  ownerUid?: number;
  log?: (msg: string) => void;
};

/** Tabelas com tenant_id que não voltam numa restauração de empresa (sessões e registros técnicos). */
const SKIP_TABLES = new Set(['sessions', 'audit_log', 'auth_events', 'password_resets']);
const TMP_DB = 'crm_restaurar';

function run(cmd: string, args: string[], opts: { env?: Record<string, string>; input?: string } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env: { ...process.env, ...opts.env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} saiu com ${code}: ${err.trim().slice(-1500)}`))));
    if (opts.input !== undefined) p.stdin.end(opts.input);
    else p.stdin.end();
  });
}

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Linhas de um bloco COPY (texto) num objeto por coluna. */
export function parseCopy(sqlText: string, table: string): Record<string, string | null>[] {
  const lines = sqlText.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^COPY [a-z_]+\\.${table} \\(`).test(l));
  if (start < 0) return [];
  const cols = /\(([^)]*)\)/.exec(lines[start]!)![1]!.split(',').map((c) => c.trim().replace(/"/g, ''));
  const rows: Record<string, string | null>[] = [];
  for (let i = start + 1; i < lines.length && lines[i] !== '\\.'; i++) {
    const vals = lines[i]!.split('\t').map((v) => (v === '\\N' ? null : v.replace(/\\(.)/g, (_m, c: string) => ({ t: '\t', n: '\n', r: '\r', '\\': '\\' }[c] ?? c))));
    rows.push(Object.fromEntries(cols.map((c, j) => [c, vals[j] ?? null])));
  }
  return rows;
}

export class BackupAgent {
  readonly version = '1';
  private busy: string | null = null;
  private readonly log: (msg: string) => void;

  constructor(private readonly o: AgentOptions) {
    this.log = o.log ?? ((m) => console.log(`backup: ${m}`));
  }

  private client(database: string): pg.Client {
    return new pg.Client({ database });
  }

  private async withDb<T>(database: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
    const c = this.client(database);
    await c.connect();
    try {
      return await fn(c);
    } finally {
      await c.end();
    }
  }

  private async own(file: string): Promise<void> {
    if (this.o.ownerUid === undefined) return;
    await chown(file, this.o.ownerUid, this.o.ownerUid).catch(() => undefined);
  }

  async prepareDirs(): Promise<void> {
    for (const d of [this.o.backupDir, jobsDir(this.o.backupDir), uploadsDir(this.o.backupDir)]) {
      await mkdir(d, { recursive: true });
      await this.own(d);
      await chmod(d, 0o750).catch(() => undefined);
    }
  }

  // ---- Cópia ---------------------------------------------------------------------

  /** Cópia agora: um .tar com o banco (pg_dump), os arquivos e o manifesto. */
  async backupNow(kind: BackupKind, step: (m: string) => void = this.log): Promise<Manifest> {
    await this.prepareDirs();
    const name = `crm-${stamp()}-${kind}.tar`;
    const work = await mkdtemp(path.join(tmpdir(), 'crm-copia-'));
    try {
      step('copiando o banco');
      // Com donos e permissões: a restauração no mesmo servidor volta igual.
      await run('pg_dump', ['--format=custom', '--compress=9', `--file=${path.join(work, 'banco.dump')}`], { env: { PGDATABASE: this.o.database } });
      await run('pg_restore', ['--list', path.join(work, 'banco.dump')]);
      let includesFiles = false;
      if (existsSync(this.o.filesDir)) {
        step('copiando os arquivos');
        await run('tar', ['-czf', path.join(work, 'arquivos.tar.gz'), '--exclude=./.anterior-*', '-C', this.o.filesDir, '.']);
        includesFiles = true;
      }
      const info = await this.dumpInfo(path.join(work, 'banco.dump'));
      const manifest: Manifest = {
        name, createdAt: new Date().toISOString(), kind, format: 'tar', includesFiles, sizeBytes: 0, ...info,
      };
      await writeFile(path.join(work, 'manifest.json'), JSON.stringify(manifest, null, 2));
      const tmp = path.join(this.o.backupDir, `.${name}.parcial`);
      await run('tar', ['-cf', tmp, '-C', work, 'manifest.json', 'banco.dump', ...(includesFiles ? ['arquivos.tar.gz'] : [])]);
      const final = path.join(this.o.backupDir, name);
      await rename(tmp, final);
      await chmod(final, 0o640);
      await this.own(final);
      manifest.sizeBytes = (await stat(final)).size;
      await this.writeManifest(manifest);
      step(`cópia pronta: ${name}`);
      await this.applyRetention();
      return manifest;
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }

  private async writeManifest(m: Manifest): Promise<void> {
    const f = manifestFile(this.o.backupDir, m.name);
    await writeFile(f, JSON.stringify(m, null, 2));
    await chmod(f, 0o640);
    await this.own(f);
  }

  /** Empresas e migrações dentro de uma cópia, lidas sem restaurar. */
  async dumpInfo(dump: string): Promise<{ migrations: string[]; tenants: Manifest['tenants'] }> {
    const t = await run('pg_restore', ['--data-only', '--schema=public', '--table=tenants', '-f', '-', dump]);
    const m = await run('pg_restore', ['--data-only', '--schema=ctl', '--table=migrations', '-f', '-', dump]);
    return {
      tenants: parseCopy(t, 'tenants').map((r) => ({ id: r.id!, name: r.name!, slug: r.slug!, status: r.status ?? 'active' })),
      migrations: parseCopy(m, 'migrations').map((r) => r.name!).sort(),
    };
  }

  /** Retenção das diárias (7 diárias, 4 de domingo, 6 de dia 1); antes de restaurar: as 3 últimas. Manuais e enviadas ficam. */
  async applyRetention(): Promise<void> {
    const files = (await readdir(this.o.backupDir)).filter((f) => BACKUP_NAME.test(f)).sort().reverse();
    const daily = files.filter((f) => f.endsWith('-diaria.tar') || f.endsWith('.dump'));
    const keep = new Set(daily.slice(0, 7));
    const day = (f: string) => { const d = /crm-(\d{4})(\d{2})(\d{2})/.exec(f)!; return new Date(Date.UTC(+d[1]!, +d[2]! - 1, +d[3]!)); };
    daily.filter((f) => day(f).getUTCDay() === 0).slice(0, 4).forEach((f) => keep.add(f));
    daily.filter((f) => day(f).getUTCDate() === 1).slice(0, 6).forEach((f) => keep.add(f));
    files.filter((f) => f.includes('-antes-de-restaurar')).slice(0, 3).forEach((f) => keep.add(f));
    for (const f of files) {
      if (daily.includes(f) || f.includes('-antes-de-restaurar')) {
        if (!keep.has(f)) {
          await rm(path.join(this.o.backupDir, f), { force: true });
          await rm(manifestFile(this.o.backupDir, f), { force: true });
          this.log(`removida pela retenção: ${f}`);
        }
      }
    }
  }

  /** Cópia sem manifesto (antiga ou enviada): confere e cria o manifesto. */
  async inspect(name: string, kind: BackupKind): Promise<Manifest> {
    const file = path.join(this.o.backupDir, name);
    const work = await mkdtemp(path.join(tmpdir(), 'crm-ver-'));
    try {
      const { dump, includesFiles } = await this.unpack(file, work, false);
      await run('pg_restore', ['--list', dump]);
      const info = await this.dumpInfo(dump);
      const s = await stat(file);
      const createdFromName = /crm-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(name);
      const m: Manifest = {
        name, kind, format: name.endsWith('.tar') ? 'tar' : 'dump', includesFiles, sizeBytes: s.size, ...info,
        createdAt: createdFromName
          ? new Date(`${createdFromName[1]}-${createdFromName[2]}-${createdFromName[3]}T${createdFromName[4]}:${createdFromName[5]}:${createdFromName[6]}`).toISOString()
          : s.mtime.toISOString(),
      };
      await chmod(file, 0o640).catch(() => undefined);
      await this.own(file);
      await this.writeManifest(m);
      return m;
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }

  /** Abre a cópia numa pasta de trabalho: o .dump do banco e, se houver, os arquivos. */
  private async unpack(file: string, work: string, withFiles: boolean): Promise<{ dump: string; files: string | null; includesFiles: boolean }> {
    if (file.endsWith('.dump')) return { dump: file, files: null, includesFiles: false };
    const members = (await run('tar', ['-tf', file])).split('\n').map((s) => s.trim()).filter(Boolean);
    if (!members.includes('banco.dump')) throw new Error('o arquivo não é uma cópia do CRM (falta banco.dump)');
    const includesFiles = members.includes('arquivos.tar.gz');
    await run('tar', ['-xf', file, '-C', work, 'banco.dump', ...(withFiles && includesFiles ? ['arquivos.tar.gz'] : [])]);
    return { dump: path.join(work, 'banco.dump'), files: withFiles && includesFiles ? path.join(work, 'arquivos.tar.gz') : null, includesFiles };
  }

  // ---- Restauração -------------------------------------------------------------------

  /** Restaura a cópia num banco temporário, com os mesmos donos do banco atual e as migrações em dia. */
  private async restoreToTemp(dump: string, step: (m: string) => void): Promise<void> {
    await this.withDb('postgres', async (c) => {
      await c.query(`drop database if exists ${TMP_DB} with (force)`);
      await c.query(`create database ${TMP_DB}`);
    });
    step('restaurando a cópia num banco temporário');
    await run('pg_restore', ['--exit-on-error', `--dbname=${TMP_DB}`, dump]);
    step('conferindo donos e permissões');
    await this.copyOwnership(this.o.database, TMP_DB);
    await this.withDb('postgres', (c) => c.query(
      `do $$ begin if exists (select from pg_roles where rolname = 'crm_owner') then execute 'grant create on database ${TMP_DB} to crm_owner'; end if; end $$`));
    step('aplicando as migrações desta versão');
    await run(this.o.migrateScript, [], { env: { DATABASE_URL: this.urlFor(TMP_DB) } });
  }

  private urlFor(database: string): string {
    const u = new URL('postgres://localhost');
    u.hostname = process.env.PGHOST ?? 'localhost';
    u.port = process.env.PGPORT ?? '5432';
    u.username = process.env.PGUSER ?? 'postgres';
    if (process.env.PGPASSWORD) u.password = process.env.PGPASSWORD;
    u.pathname = `/${database}`;
    if (u.hostname.startsWith('/')) return `postgres:///${database}?host=${encodeURIComponent(u.hostname)}&port=${u.port}&user=${u.username}`;
    return u.toString();
  }

  /**
   * Cópias antigas (sem donos) restauram com tudo do usuário postgres; as
   * funções e migrações do CRM dependem de crm_owner. Copia os donos do banco
   * atual para o restaurado, objeto a objeto.
   */
  private async copyOwnership(from: string, to: string): Promise<void> {
    const schemasSql = `select nspname from pg_namespace where nspname !~ '^pg_' and nspname <> 'information_schema'`;
    const map = await this.withDb(from, async (c) => ({
      schemas: (await c.query<{ n: string; o: string }>(`select nspname as n, nspowner::regrole::text as o from pg_namespace where nspname in (${schemasSql})`)).rows,
      rels: (await c.query<{ s: string; n: string; k: string; o: string }>(
        `select n.nspname as s, c.relname as n, c.relkind as k, c.relowner::regrole::text as o
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname in (${schemasSql}) and c.relkind in ('r', 'p', 'v', 'm', 'f')`)).rows,
      funcs: (await c.query<{ sig: string; o: string }>(
        `select p.oid::regprocedure::text as sig, p.proowner::regrole::text as o from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname in (${schemasSql}) and not exists (select from pg_depend d where d.objid = p.oid and d.deptype = 'e')`)).rows,
      types: (await c.query<{ sig: string; t: string; o: string }>(
        `select t.oid::regtype::text as sig, t.typtype as t, t.typowner::regrole::text as o from pg_type t join pg_namespace n on n.oid = t.typnamespace
          where n.nspname in (${schemasSql}) and t.typtype in ('e', 'd')
            and not exists (select from pg_depend d where d.objid = t.oid and d.deptype = 'e')`)).rows,
    }));
    await this.withDb(to, async (c) => {
      const exists = async (sql: string, p: unknown[]) => ((await c.query(sql, p)).rowCount ?? 0) > 0;
      const stmts: string[] = [];
      for (const s of map.schemas) {
        if (await exists('select 1 from pg_namespace where nspname = $1 and nspowner::regrole::text <> $2', [s.n, s.o])) stmts.push(`alter schema ${ident(s.n)} owner to ${s.o}`);
      }
      for (const r of map.rels) {
        if (await exists(`select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = $1 and c.relname = $2 and c.relowner::regrole::text <> $3`, [r.s, r.n, r.o])) {
          const kw = r.k === 'v' ? 'view' : r.k === 'm' ? 'materialized view' : r.k === 'f' ? 'foreign table' : 'table';
          stmts.push(`alter ${kw} ${ident(r.s)}.${ident(r.n)} owner to ${r.o}`);
        }
      }
      for (const f of map.funcs) {
        if (await exists(`select 1 from pg_proc where oid = to_regprocedure($1) and proowner::regrole::text <> $2`, [f.sig, f.o])) stmts.push(`alter routine ${f.sig} owner to ${f.o}`);
      }
      for (const t of map.types) {
        if (await exists(`select 1 from pg_type where oid = to_regtype($1) and typowner::regrole::text <> $2`, [t.sig, t.o])) stmts.push(`alter ${t.t === 'd' ? 'domain' : 'type'} ${t.sig} owner to ${t.o}`);
      }
      for (const s of stmts) await c.query(s);
    });
  }

  /** Restaura o banco inteiro: troca o banco em uso pelo restaurado (o anterior fica guardado). */
  async restoreFull(name: string, step: (m: string) => void = this.log): Promise<string> {
    const file = path.join(this.o.backupDir, name);
    step('fazendo uma cópia do estado atual antes de restaurar');
    const safety = await this.backupNow('antes-de-restaurar', () => undefined);
    step(`cópia de segurança: ${safety.name}`);
    const work = await mkdtemp(path.join(tmpdir(), 'crm-rest-'));
    try {
      const { dump, files } = await this.unpack(file, work, true);
      await this.restoreToTemp(dump, step);
      const old = `${this.o.database}_anterior_${stamp().replace('-', '_')}`;
      step('trocando o banco em uso pelo restaurado');
      await this.withDb('postgres', async (c) => {
        await c.query(`alter database ${ident(this.o.database)} allow_connections false`);
        try {
          await c.query('select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()', [this.o.database]);
          await c.query(`alter database ${ident(this.o.database)} rename to ${ident(old)}`);
          await c.query(`alter database ${TMP_DB} rename to ${ident(this.o.database)}`);
        } finally {
          await c.query(`alter database ${ident(existsDbName(old))} allow_connections true`).catch(async () => {
            await c.query(`alter database ${ident(this.o.database)} allow_connections true`).catch(() => undefined);
          });
        }
        // Guarda só o banco anterior mais recente.
        const olds = (await c.query<{ datname: string }>(
          `select datname from pg_database where datname like $1 order by datname desc`, [`${this.o.database}_anterior_%`])).rows.map((r) => r.datname);
        for (const d of olds.slice(1)) await c.query(`drop database if exists ${ident(d)} with (force)`);
      });
      if (files) {
        step('restaurando os arquivos');
        await this.replaceAllFiles(files);
      }
      step(`banco restaurado; o anterior ficou guardado como ${old}`);
      return `Restaurado de ${name}. Cópia do estado anterior: ${safety.name}.`;
    } finally {
      await rm(work, { recursive: true, force: true });
      await this.withDb('postgres', (c) => c.query(`drop database if exists ${TMP_DB} with (force)`)).catch(() => undefined);
    }
  }

  private async replaceAllFiles(archive: string): Promise<void> {
    await mkdir(this.o.filesDir, { recursive: true });
    const keep = path.join(this.o.filesDir, `.anterior-${stamp()}`);
    await mkdir(keep);
    for (const e of await readdir(this.o.filesDir)) {
      if (e.startsWith('.anterior-')) continue;
      await rename(path.join(this.o.filesDir, e), path.join(keep, e));
    }
    await run('tar', ['-xzf', archive, '-C', this.o.filesDir]);
    await run('chown', ['-R', `${this.o.ownerUid ?? 1000}:${this.o.ownerUid ?? 1000}`, this.o.filesDir]).catch(() => undefined);
    const olds = (await readdir(this.o.filesDir)).filter((e) => e.startsWith('.anterior-')).sort().reverse();
    for (const d of olds.slice(1)) await rm(path.join(this.o.filesDir, d), { recursive: true, force: true });
  }

  /** Restaura uma empresa: apaga a atual (se existir) e traz de volta tudo dela da cópia. */
  async restoreTenant(name: string, tenantId: string, step: (m: string) => void = this.log): Promise<string> {
    if (!/^[0-9a-f-]{36}$/.test(tenantId)) throw new Error('empresa inválida');
    const file = path.join(this.o.backupDir, name);
    step('fazendo uma cópia do estado atual antes de restaurar');
    const safety = await this.backupNow('antes-de-restaurar', () => undefined);
    step(`cópia de segurança: ${safety.name}`);
    const work = await mkdtemp(path.join(tmpdir(), 'crm-rest-'));
    try {
      const { dump, files } = await this.unpack(file, work, true);
      await this.restoreToTemp(dump, step);
      const found = await this.withDb(TMP_DB, (c) => c.query<{ name: string }>('select name from tenants where id = $1', [tenantId]));
      if (!found.rows[0]) throw new Error('esta empresa não existe na cópia escolhida');
      const tenantName = found.rows[0].name;

      // Tabelas da empresa e colunas que dá para inserir (sem as geradas).
      const tables = await this.withDb(this.o.database, async (c) => (await c.query<{ t: string; cols: string[] }>(
        `select c.relname as t,
                array_agg(a.attname::text order by a.attnum) filter (where a.attgenerated = '') as cols
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
           join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
          where c.relkind in ('r', 'p') and not c.relispartition
            and (exists (select from pg_attribute x where x.attrelid = c.oid and x.attname = 'tenant_id' and not x.attisdropped)
                 or c.relname in ('tenants', 'users'))
          group by c.relname order by c.relname`)).rows.filter((r) => !SKIP_TABLES.has(r.t)));

      step('separando os dados da empresa');
      const dir = path.join(work, 'dados');
      await mkdir(dir);
      const where = (t: string) => t === 'tenants' ? `id = ${lit(tenantId)}`
        : t === 'users' ? `id in (select user_id from public.memberships where tenant_id = ${lit(tenantId)})`
          : `tenant_id = ${lit(tenantId)}`;
      for (const { t, cols } of tables) {
        const list = cols.map(ident).join(', ');
        await run('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-c',
          `\\copy (select ${list} from public.${ident(t)} where ${where(t)}) to ${lit(path.join(dir, `${t}.tsv`))}`], { env: { PGDATABASE: TMP_DB } });
      }

      step('gravando a empresa no banco em uso');
      const order = ['tenants', ...tables.map((x) => x.t).filter((t) => t !== 'tenants' && t !== 'users')];
      const byName = new Map(tables.map((x) => [x.t, x.cols]));
      const users = byName.get('users')!;
      const script = [
        '\\set ON_ERROR_STOP 1',
        'begin;',
        // Sessões abertas na empresa continuam valendo (quem restaura não é derrubado).
        `create temp table r_keep_sessions on commit drop as select * from public.sessions where tenant_id = ${lit(tenantId)};`,
        // A exclusão em cascata (e os gatilhos) valem aqui; a cópia vem depois, sem gatilhos.
        `delete from public.tenants where id = ${lit(tenantId)};`,
        'set local session_replication_role = replica;',
        `create temp table r_users (like public.users) on commit drop;`,
        `\\copy r_users (${users.map(ident).join(', ')}) from ${lit(path.join(dir, 'users.tsv'))}`,
        `insert into public.users (${users.map(ident).join(', ')}) select ${users.map((c) => `r.${ident(c)}`).join(', ')} from r_users r
           where not exists (select from public.users u where u.id = r.id or u.email = r.email);`,
        ...order.flatMap((t) => {
          const cols = byName.get(t)!.map(ident).join(', ');
          return [
            `create temp table ${ident(`r_${t}`)} (like public.${ident(t)}) on commit drop;`,
            `\\copy ${ident(`r_${t}`)} (${cols}) from ${lit(path.join(dir, `${t}.tsv`))}`,
            `insert into public.${ident(t)} (${cols}) overriding system value select ${cols} from ${ident(`r_${t}`)} on conflict do nothing;`,
          ];
        }),
        `insert into public.sessions select * from r_keep_sessions on conflict do nothing;`,
        // Pessoa que hoje tem outro cadastro com o mesmo e-mail: o vínculo vai para o cadastro atual.
        `update public.memberships m set user_id = u.id from r_users r join public.users u on u.email = r.email
           where m.tenant_id = ${lit(tenantId)} and m.user_id = r.id and u.id <> r.id;`,
        // Referências a planos ou pessoas que não existem mais ficam vazias.
        `do $$
         declare f record;
         begin
           for f in
             select cl.relname as tbl, a.attname as col, rc.relname as ref
               from pg_constraint k
               join pg_class cl on cl.oid = k.conrelid
               join pg_namespace n on n.oid = cl.relnamespace and n.nspname = 'public'
               join pg_class rc on rc.oid = k.confrelid
               join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
              where k.contype = 'f' and rc.relname in ('users', 'plans') and array_length(k.conkey, 1) = 1 and not a.attnotnull
                and exists (select from pg_attribute x where x.attrelid = cl.oid and x.attname = 'tenant_id')
           loop
             execute format('update public.%I t set %I = null where t.tenant_id = %L and t.%I is not null and not exists (select from public.%I r where r.id = t.%I)',
                            f.tbl, f.col, ${lit(tenantId)}, f.col, f.ref, f.col);
           end loop;
         end $$;`,
        'commit;',
      ].filter(Boolean).join('\n');
      await run('psql', ['-X', '-q', '-f', '-'], { env: { PGDATABASE: this.o.database }, input: script });

      if (files) {
        step('restaurando os arquivos da empresa');
        const target = path.join(this.o.filesDir, tenantId);
        await rm(target, { recursive: true, force: true });
        await mkdir(this.o.filesDir, { recursive: true });
        await run('tar', ['-xzf', files, '-C', this.o.filesDir, `./${tenantId}`]).catch((e: Error) => {
          if (!/Not found in archive|não encontrado/i.test(e.message)) throw e;
        });
        await run('chown', ['-R', `${this.o.ownerUid ?? 1000}:${this.o.ownerUid ?? 1000}`, this.o.filesDir]).catch(() => undefined);
      }
      step(`empresa "${tenantName}" restaurada`);
      return `Empresa "${tenantName}" restaurada de ${name}. Cópia do estado anterior: ${safety.name}.`;
    } finally {
      await rm(work, { recursive: true, force: true });
      await this.withDb('postgres', (c) => c.query(`drop database if exists ${TMP_DB} with (force)`)).catch(() => undefined);
    }
  }

  // ---- Fila e laço ---------------------------------------------------------------------

  private saving: Promise<void> = Promise.resolve();

  /** Grava o trabalho; as gravações saem em fila, cada uma num arquivo temporário próprio. */
  private saveJob(job: Job): Promise<void> {
    const snapshot = JSON.stringify(job, null, 2);
    const next = this.saving.then(async () => {
      const f = path.join(jobsDir(this.o.backupDir), `${job.id}.json`);
      const tmp = `${f}.${randomUUID()}.tmp`;
      await writeFile(tmp, snapshot);
      await rename(tmp, f);
      await this.own(f);
    });
    this.saving = next.catch(() => undefined);
    return next;
  }

  async runJob(job: Job): Promise<Job> {
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    await this.saveJob(job);
    this.busy = job.type;
    const step = (m: string) => {
      job.log.push(`${new Date().toISOString()} ${m}`);
      this.log(m);
      void this.saveJob(job).catch(() => undefined);
    };
    try {
      if (job.type === 'backup') job.result = (await this.backupNow('manual', step)).name;
      else if (job.type === 'inspect') job.result = (await this.inspect(job.file!, 'enviada')).name;
      else if (job.type === 'restore_full') job.result = await this.restoreFull(job.file!, step);
      else if (job.type === 'restore_tenant') job.result = await this.restoreTenant(job.file!, job.tenantId!, step);
      job.status = 'done';
    } catch (err) {
      job.status = 'failed';
      job.error = (err as Error).message.slice(0, 2000);
      step(`falhou: ${job.error}`);
      if (job.type === 'inspect' && job.file) {
        await rm(path.join(this.o.backupDir, job.file), { force: true });
      }
    } finally {
      this.busy = null;
      job.finishedAt = new Date().toISOString();
      await this.saveJob(job);
    }
    return job;
  }

  /** Uma volta: sinal de vida, cópias sem manifesto e o próximo pedido da fila. */
  async tick(nextDaily: Date | null): Promise<void> {
    await this.prepareDirs();
    await this.beat(nextDaily);
    for (const f of await readdir(this.o.backupDir)) {
      if (BACKUP_NAME.test(f) && !existsSync(manifestFile(this.o.backupDir, f))) {
        await this.inspect(f, f.endsWith('.dump') ? 'antiga' : 'manual').catch((e) => this.log(`cópia ilegível ${f}: ${(e as Error).message}`));
      }
    }
    const dir = jobsDir(this.o.backupDir);
    const pending: Job[] = [];
    for (const f of await readdir(dir)) {
      if (!/^[0-9a-f-]{36}\.json$/.test(f)) continue;
      const j = JSON.parse(await readFile(path.join(dir, f), 'utf8')) as Job;
      if (j.status === 'pending') pending.push(j);
      // Pedido que estava rodando quando o serviço caiu.
      if (j.status === 'running' && !this.busy) {
        j.status = 'failed';
        j.error = 'O serviço de cópias reiniciou no meio do trabalho. Confira o estado e peça de novo.';
        await this.saveJob(j);
      }
    }
    pending.sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
    if (pending[0]) await this.runJob(pending[0]);
  }

  async beat(nextDaily: Date | null): Promise<void> {
    const f = beatFile(this.o.backupDir);
    await writeFile(f, JSON.stringify({ at: new Date().toISOString(), version: this.version, nextDaily: nextDaily?.toISOString() ?? null, busy: this.busy }));
    await this.own(f);
  }

  newJob(type: Job['type'], extra: Partial<Job> = {}): Job {
    return { id: randomUUID(), type, requestedBy: 'agente', requestedAt: new Date().toISOString(), status: 'pending', log: [], ...extra };
  }
}

/** Nome de banco já validado (só letras, números e sublinhado). */
function existsDbName(n: string): string {
  if (!/^[a-z0-9_]+$/.test(n)) throw new Error('nome de banco inválido');
  return n;
}
