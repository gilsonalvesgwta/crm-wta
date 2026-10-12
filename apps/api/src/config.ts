import { readFileSync } from 'node:fs';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  /** Conexão do papel crm_api, que só troca para crm_app ou crm_platform. */
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  /** Endereço público da interface, usado nos links dos e-mails. */
  APP_URL: z.string().url(),
  APP_NAME: z.string().min(1).default('CRM WTA'),
  /** Chaves de cifragem: "1:base64,2:base64". A última é a atual. */
  MASTER_KEYS: z.string().min(1),
  COOKIE_SECURE: bool,
  TRUST_PROXY: bool,
  MAIL_MODE: z.enum(['smtp', 'memory', 'log', 'file']).default('log'),
  /** Com MAIL_MODE=file, cada e-mail vira um arquivo JSON nesta pasta (testes de ponta a ponta). */
  MAIL_DIR: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'silent']).default('info'),
});

export type Config = z.infer<typeof schema> & { masterKeys: Record<number, Buffer>; currentKey: number };

export const CONFIG = Symbol('CONFIG');

/** Segredos podem vir de arquivo (segredos do Docker): FOO_FILE=/run/secrets/foo. */
const FILE_KEYS = ['DATABASE_URL', 'MASTER_KEYS', 'SMTP_PASS'] as const;

function withFiles(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const out = { ...env };
  for (const k of FILE_KEYS) {
    const file = env[`${k}_FILE`];
    if (file && !env[k]) out[k] = readFileSync(file, 'utf8').trim();
  }
  return out;
}

export function loadConfig(rawEnv: Record<string, string | undefined> = process.env): Config {
  const env = withFiles(rawEnv);
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`configuração inválida: ${fields}`);
  }
  const cfg = parsed.data;
  const masterKeys: Record<number, Buffer> = {};
  let currentKey = 0;
  for (const part of cfg.MASTER_KEYS.split(',')) {
    const [id, b64] = part.split(':');
    const n = Number(id);
    const key = Buffer.from(b64 ?? '', 'base64');
    if (!Number.isInteger(n) || n < 1 || n > 255 || key.length !== 32) {
      throw new Error('MASTER_KEYS inválida: use "1:<32 bytes em base64>"');
    }
    masterKeys[n] = key;
    currentKey = n;
  }
  if (cfg.MAIL_MODE === 'file' && !cfg.MAIL_DIR) throw new Error('MAIL_MODE=file exige MAIL_DIR');
  if (cfg.MAIL_MODE === 'file' && cfg.NODE_ENV === 'production') throw new Error('MAIL_MODE=file não é permitido em produção');
  if (cfg.MAIL_MODE === 'smtp' && (!cfg.SMTP_HOST || !cfg.SMTP_FROM)) {
    throw new Error('MAIL_MODE=smtp exige SMTP_HOST e SMTP_FROM');
  }
  return { ...cfg, masterKeys, currentKey };
}
