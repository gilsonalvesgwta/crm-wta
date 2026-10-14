import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Actor } from '../access/actor.js';
import { CONFIG, type Config } from '../config.js';
import { Problem } from '../http/problem.js';
import {
  BACKUP_NAME, JOB_ID, beatFile, jobsDir, manifestFile, stamp, uploadsDir, type AgentBeat, type Job, type Manifest,
} from './format.js';

/** Sem sinal do agente há mais que isto: o serviço "backup" está parado. */
const AGENT_STALE_MS = 60_000;

/**
 * Cópias de segurança para a Plataforma. A API só lê a pasta das cópias e
 * escreve pedidos; quem copia e restaura é o agente do serviço "backup".
 */
@Injectable()
export class BackupsService {
  private readonly log = new Logger('copias');

  constructor(@Inject(CONFIG) private readonly cfg: Config) {}

  private get dir(): string {
    return this.cfg.BACKUP_DIR;
  }

  get available(): boolean {
    return existsSync(jobsDir(this.dir));
  }

  private assertAvailable(): void {
    if (!this.available) {
      throw new Problem(409, 'As cópias ainda não estão ligadas à API: atualize a stack com o arquivo novo (volume crmwta_backup na API).', 'backups-unavailable');
    }
  }

  private file(name: string): string {
    if (!BACKUP_NAME.test(name)) throw Problem.notFound('Cópia não encontrada.');
    const f = path.join(this.dir, name);
    if (!existsSync(f)) throw Problem.notFound('Cópia não encontrada.');
    return f;
  }

  private async readJson<T>(f: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(f, 'utf8')) as T;
    } catch {
      return null;
    }
  }

  async jobs(limit = 20): Promise<Job[]> {
    const dir = jobsDir(this.dir);
    const out: Job[] = [];
    for (const f of await readdir(dir).catch(() => [] as string[])) {
      if (!/^[0-9a-f-]{36}\.json$/.test(f)) continue;
      const j = await this.readJson<Job>(path.join(dir, f));
      if (j) out.push(j);
    }
    return out.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)).slice(0, limit);
  }

  async overview() {
    if (!this.available) return { available: false, agent: null, items: [], jobs: [] };
    const beat = await this.readJson<AgentBeat>(beatFile(this.dir));
    const items: (Manifest & { pending?: boolean })[] = [];
    for (const f of (await readdir(this.dir)).filter((n) => BACKUP_NAME.test(n))) {
      const m = await this.readJson<Manifest>(manifestFile(this.dir, f));
      if (m) items.push(m);
      else {
        const s = await stat(path.join(this.dir, f)).catch(() => null);
        if (s) items.push({ name: f, createdAt: s.mtime.toISOString(), kind: 'enviada', format: f.endsWith('.tar') ? 'tar' : 'dump', includesFiles: false, sizeBytes: s.size, migrations: [], tenants: [], pending: true });
      }
    }
    items.sort((a, b) => b.name.localeCompare(a.name));
    return {
      available: true,
      agent: beat ? { ...beat, alive: Date.now() - Date.parse(beat.at) < AGENT_STALE_MS } : { alive: false, at: null, nextDaily: null, busy: null, version: null },
      items,
      jobs: await this.jobs(),
    };
  }

  private async enqueue(actor: Actor, type: Job['type'], extra: Partial<Job> = {}): Promise<Job> {
    this.assertAvailable();
    const running = (await this.jobs(50)).find((j) => j.status === 'pending' || j.status === 'running');
    if (running && type !== 'inspect') {
      throw Problem.conflict('Já há um trabalho de cópia ou restauração em andamento. Espere terminar.');
    }
    const job: Job = { id: randomUUID(), type, requestedBy: actor.email, requestedAt: new Date().toISOString(), status: 'pending', log: [], ...extra };
    const f = path.join(jobsDir(this.dir), `${job.id}.json`);
    await writeFile(`${f}.tmp`, JSON.stringify(job, null, 2));
    await rename(`${f}.tmp`, f);
    this.log.log(`${actor.email} pediu ${type}${extra.file ? ` de ${extra.file}` : ''}${extra.tenantId ? ` (empresa ${extra.tenantId})` : ''}`);
    return job;
  }

  async job(id: string): Promise<Job> {
    if (!JOB_ID.test(id)) throw Problem.notFound();
    const j = await this.readJson<Job>(path.join(jobsDir(this.dir), `${id}.json`));
    if (!j) throw Problem.notFound('Trabalho não encontrado.');
    return j;
  }

  backupNow(actor: Actor): Promise<Job> {
    return this.enqueue(actor, 'backup');
  }

  async restore(actor: Actor, name: string, scope: 'full' | 'tenant', tenantId?: string): Promise<Job> {
    this.assertAvailable();
    this.file(name);
    const m = await this.readJson<Manifest>(manifestFile(this.dir, name));
    if (!m) throw Problem.conflict('Esta cópia ainda está sendo conferida. Tente em instantes.');
    if (scope === 'tenant') {
      if (!tenantId || !m.tenants.some((t) => t.id === tenantId)) {
        throw Problem.badRequest('Empresa não está nesta cópia.', [{ field: 'tenantId', message: 'Escolha uma empresa que existe na cópia.' }]);
      }
      return this.enqueue(actor, 'restore_tenant', { file: name, tenantId });
    }
    return this.enqueue(actor, 'restore_full', { file: name });
  }

  async open(actor: Actor, name: string): Promise<{ stream: Readable; size: number }> {
    this.assertAvailable();
    const f = this.file(name);
    const s = await stat(f);
    this.log.log(`${actor.email} baixou a cópia ${name}`);
    return { stream: createReadStream(f), size: s.size };
  }

  async remove(actor: Actor, name: string): Promise<void> {
    this.assertAvailable();
    const f = this.file(name);
    const busy = (await this.jobs(50)).find((j) => (j.status === 'pending' || j.status === 'running') && j.file === name);
    if (busy) throw Problem.conflict('Esta cópia está sendo usada por um trabalho em andamento.');
    await rm(f, { force: true });
    await rm(manifestFile(this.dir, name), { force: true });
    this.log.log(`${actor.email} excluiu a cópia ${name}`);
  }

  /** Recebe um arquivo de cópia guardado fora (multipart, campo "file"); o agente confere. */
  async upload(actor: Actor, filename: string, stream: Readable & { truncated?: boolean }): Promise<Job> {
    this.assertAvailable();
    const ext = filename.toLowerCase().endsWith('.dump') ? 'dump' : filename.toLowerCase().endsWith('.tar') ? 'tar' : null;
    if (!ext) throw Problem.badRequest('Arquivo não aceito.', [{ field: 'file', message: 'Envie um arquivo de cópia do CRM (.tar ou .dump).' }]);
    const name = `crm-${stamp()}-enviada.${ext}`;
    const tmp = path.join(uploadsDir(this.dir), `${name}.${randomUUID()}.parcial`);
    try {
      await pipeline(stream, createWriteStream(tmp, { mode: 0o640 }));
      if (stream.truncated) throw new Problem(413, 'O arquivo passa do limite de envio.');
      await rename(tmp, path.join(this.dir, name));
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
    return this.enqueue(actor, 'inspect', { file: name });
  }

  // ---- Cópias de uma empresa (administrador da empresa) --------------------------------

  private tenantDir(tenantId: string): string {
    return path.join(this.dir, 'empresas', tenantId);
  }

  private tenantFile(tenantId: string, name: string): string {
    if (!BACKUP_NAME.test(name) || !name.endsWith('-empresa.tar')) throw Problem.notFound('Cópia não encontrada.');
    const f = path.join(this.tenantDir(tenantId), name);
    if (!existsSync(f)) throw Problem.notFound('Cópia não encontrada.');
    return f;
  }

  async tenantOverview(actor: Actor) {
    const tenantId = actor.tenantId!;
    if (!this.available) return { available: false, retentionDays: this.cfg.TENANT_BACKUP_DAYS, agentAlive: false, items: [], jobs: [] };
    const beat = await this.readJson<AgentBeat>(beatFile(this.dir));
    const items: Manifest[] = [];
    for (const f of (await readdir(this.tenantDir(tenantId)).catch(() => [] as string[])).filter((n) => BACKUP_NAME.test(n))) {
      const m = await this.readJson<Manifest>(manifestFile(this.tenantDir(tenantId), f));
      if (m) items.push({ ...m, tables: undefined, migrations: [] });
    }
    items.sort((a, b) => b.name.localeCompare(a.name));
    const jobs = (await this.jobs(200)).filter((j) => j.tenantId === tenantId && (j.type === 'backup_tenant' || j.type === 'restore_tenant_backup')).slice(0, 10);
    return {
      available: true, retentionDays: this.cfg.TENANT_BACKUP_DAYS,
      agentAlive: !!beat && Date.now() - Date.parse(beat.at) < AGENT_STALE_MS,
      items: items.map((m) => ({ ...m, expiresAt: new Date(Date.parse(m.createdAt) + this.cfg.TENANT_BACKUP_DAYS * 86_400_000).toISOString() })),
      jobs: jobs.map((j) => ({ ...j, requestedBy: j.requestedBy })),
    };
  }

  async tenantBackupNow(actor: Actor): Promise<Job> {
    const n = (await readdir(this.tenantDir(actor.tenantId!)).catch(() => [] as string[])).filter((f) => BACKUP_NAME.test(f)).length;
    if (n >= 20) throw Problem.conflict('A empresa já tem 20 cópias guardadas. Exclua alguma antes de fazer outra.');
    return this.enqueue(actor, 'backup_tenant', { tenantId: actor.tenantId! });
  }

  async tenantOpen(actor: Actor, name: string): Promise<{ stream: Readable; size: number }> {
    this.assertAvailable();
    const f = this.tenantFile(actor.tenantId!, name);
    const s = await stat(f);
    this.log.log(`${actor.email} baixou a cópia da empresa ${actor.tenantId}: ${name}`);
    return { stream: createReadStream(f), size: s.size };
  }

  async tenantRestore(actor: Actor, name: string): Promise<Job> {
    this.assertAvailable();
    this.tenantFile(actor.tenantId!, name);
    return this.enqueue(actor, 'restore_tenant_backup', { tenantId: actor.tenantId!, file: name });
  }

  async tenantRemove(actor: Actor, name: string): Promise<void> {
    this.assertAvailable();
    const f = this.tenantFile(actor.tenantId!, name);
    await rm(f, { force: true });
    await rm(manifestFile(this.tenantDir(actor.tenantId!), name), { force: true });
  }

  async tenantJob(actor: Actor, id: string): Promise<Job> {
    const j = await this.job(id);
    if (j.tenantId !== actor.tenantId || (j.type !== 'backup_tenant' && j.type !== 'restore_tenant_backup')) throw Problem.notFound();
    return j;
  }
}
