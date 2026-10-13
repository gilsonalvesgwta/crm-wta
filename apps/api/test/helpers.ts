// Infraestrutura dos testes de integração: um banco descartável por arquivo de
// teste, com as migrações reais, e a API montada sobre ele.
import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import { hash } from '@node-rs/argon2';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { loadConfig, type Config } from '../src/config.js';
import { createApp } from '../src/server.js';
import { MAILER, type MemoryMailer } from '../src/infra/mailer.js';
import { seedRoleTemplates } from '../src/platform/seed.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// Funciona tanto no código-fonte quanto no compilado (.test-out/test).
const repoRoot = path.resolve(here, here.includes('.test-out') ? '../../../..' : '../../..');
const MIGRATE = path.join(repoRoot, 'packages/db/migrate.sh');
export const API_DB_PASSWORD = 'senha-de-teste-do-papel-crm-api';
export const PASSWORD = 'senha forte de teste 2026';

function withDb(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

export type Fixture = {
  adminUrl: string;
  dbUrl: string;
  dbName: string;
  admin: pg.Client;
  tenantA: string;
  tenantB: string;
  roles: { a: Map<string, string>; b: Map<string, string> };
};

export async function createDatabase(): Promise<Fixture> {
  const base = process.env.ADMIN_URL;
  if (!base) throw new Error('defina ADMIN_URL (superusuário do Postgres de teste)');
  const dbName = `crm_api_${randomBytes(5).toString('hex')}`;
  const maint = new pg.Client({ connectionString: base });
  await maint.connect();
  await maint.query(`create database ${dbName}`);
  await maint.end();

  const adminUrl = withDb(base, dbName);
  execFileSync(MIGRATE, { env: { ...process.env, DATABASE_URL: adminUrl, API_DB_PASSWORD }, stdio: 'pipe' });

  const u = new URL(adminUrl);
  u.username = 'crm_api';
  u.password = API_DB_PASSWORD;
  const dbUrl = u.toString();

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  const t = await admin.query<{ id: string }>(
    "insert into tenants (name, slug) values ('Empresa A', 'empresa-a'), ('Empresa B', 'empresa-b') returning id");
  const tenantA = t.rows[0]!.id;
  const tenantB = t.rows[1]!.id;
  const roles = { a: await seedRoleTemplates(admin, tenantA), b: await seedRoleTemplates(admin, tenantB) };
  return { adminUrl, dbUrl, dbName, admin, tenantA, tenantB, roles };
}

export async function dropDatabase(f: Fixture): Promise<void> {
  await f.admin.end();
  const maint = new pg.Client({ connectionString: process.env.ADMIN_URL });
  await maint.connect();
  await maint.query(`drop database if exists ${f.dbName} with (force)`);
  await maint.end();
}

let cachedHash: string | null = null;
async function passwordHash(): Promise<string> {
  cachedHash ??= await hash(PASSWORD, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  return cachedHash;
}

/** Cria um usuário com vínculo e perfis nas empresas indicadas. */
export async function createUser(
  f: Fixture, email: string, links: { tenant: string; role: string }[], opts: { platformAdmin?: boolean } = {},
): Promise<string> {
  const u = await f.admin.query<{ id: string }>(
    'insert into users (email, name, password_hash, is_platform_admin) values ($1, $2, $3, $4) returning id',
    [email, email.split('@')[0], await passwordHash(), opts.platformAdmin ?? false]);
  const userId = u.rows[0]!.id;
  for (const l of links) {
    const m = await f.admin.query<{ id: string }>(
      'insert into memberships (tenant_id, user_id) values ($1, $2) returning id', [l.tenant, userId]);
    const roleId = (l.tenant === f.tenantA ? f.roles.a : f.roles.b).get(l.role);
    await f.admin.query('insert into membership_roles (tenant_id, membership_id, role_id) values ($1, $2, $3)',
      [l.tenant, m.rows[0]!.id, roleId]);
  }
  return userId;
}

export function testConfig(f: Fixture, extra: Record<string, string> = {}): Config {
  return loadConfig({
    ...extra,
    NODE_ENV: 'test',
    DATABASE_URL: f.dbUrl,
    APP_URL: 'https://crm.teste.local',
    MASTER_KEYS: `1:${randomBytes(32).toString('base64')}`,
    MAIL_MODE: 'memory',
    LOG_LEVEL: 'silent',
    COOKIE_SECURE: 'true',
    STORAGE_DIR: mkdtempSync(path.join(tmpdir(), 'crm-arquivos-')),
    DISPATCH_INTERVAL_S: '0',
  });
}

export async function startApi(f: Fixture, extra: Record<string, string> = {}): Promise<{ app: NestFastifyApplication; mailer: MemoryMailer }> {
  const app = await createApp(testConfig(f, extra), { logger: false });
  return { app, mailer: app.get<MemoryMailer>(MAILER) };
}

export type Res = { status: number; body: any; headers: Record<string, unknown> };

/** Cliente HTTP com cookie, como um navegador. */
export class Browser {
  cookie: string | null = null;
  constructor(private readonly app: NestFastifyApplication, readonly ip = '10.0.0.1') {}

  async req(method: string, url: string, body?: unknown, extra: Record<string, string> = {}): Promise<Res> {
    const headers: Record<string, string> = { ...extra };
    if (method !== 'GET' && !('x-crm-request' in extra)) headers['x-crm-request'] = '1';
    if (this.cookie) headers.cookie = this.cookie;
    const r = await this.app.inject({
      method: method as 'GET',
      url,
      headers,
      remoteAddress: this.ip,
      ...(body === undefined ? {} : { payload: body as object }),
    });
    const set = r.headers['set-cookie'];
    for (const c of Array.isArray(set) ? set : set ? [set] : []) {
      const [pair] = String(c).split(';');
      const [name, value] = pair!.split('=');
      if (name === 'crm_session') this.cookie = value ? `crm_session=${value}` : null;
    }
    let parsed: unknown = null;
    try {
      parsed = r.body ? JSON.parse(r.body) : null;
    } catch {
      parsed = r.body;
    }
    return { status: r.statusCode, body: parsed, headers: r.headers as Record<string, unknown> };
  }

  get(url: string) {
    return this.req('GET', url);
  }
  patch(url: string, body?: unknown) {
    return this.req('PATCH', url, body ?? {});
  }
  put(url: string, body?: unknown) {
    return this.req('PUT', url, body ?? {});
  }

  /** Envio multipart de um arquivo no campo "file". */
  async upload(url: string, filename: string, content: Buffer | string, contentType = 'application/octet-stream'): Promise<Res> {
    const boundary = `----crm${randomBytes(8).toString('hex')}`;
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`),
      Buffer.isBuffer(content) ? content : Buffer.from(content),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return this.req('POST', url, body, { 'content-type': `multipart/form-data; boundary=${boundary}`, 'x-crm-request': '1' });
  }

  /** GET que devolve o corpo bruto (CSV, arquivos). */
  async raw(url: string): Promise<{ status: number; body: Buffer; headers: Record<string, unknown> }> {
    const headers: Record<string, string> = {};
    if (this.cookie) headers.cookie = this.cookie;
    const r = await this.app.inject({ method: 'GET', url, headers, remoteAddress: this.ip });
    return { status: r.statusCode, body: r.rawPayload, headers: r.headers as Record<string, unknown> };
  }
  post(url: string, body?: unknown) {
    return this.req('POST', url, body ?? {});
  }
  del(url: string) {
    return this.req('DELETE', url);
  }

  async login(email: string, password = PASSWORD) {
    return this.post('/api/v1/auth/login', { email, password });
  }
}

export function tokenFromMail(text: string): string {
  const m = /token=([A-Za-z0-9_%-]+)/.exec(text);
  if (!m) throw new Error('e-mail sem token');
  return decodeURIComponent(m[1]!);
}
