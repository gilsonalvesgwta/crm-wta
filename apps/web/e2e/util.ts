import { createHash, createHmac } from 'node:crypto';
import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'dono@wta.test';
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'senha inicial forte 2026';
const MAIL_DIR = process.env.MAIL_DIR ?? '/tmp/crm-mail';
const SHOTS = process.env.E2E_SHOTS ?? 'e2e-shots';

/** Último e-mail enviado para o endereço, lido da pasta do MAIL_MODE=file. */
export function lastMailTo(to: string): { subject: string; text: string } {
  const files = readdirSync(MAIL_DIR).sort();
  for (const f of files.reverse()) {
    const m = JSON.parse(readFileSync(path.join(MAIL_DIR, f), 'utf8')) as { to: string; subject: string; text: string };
    if (m.to === to) return m;
  }
  throw new Error(`nenhum e-mail para ${to}`);
}

export function linkFrom(text: string): string {
  const m = /(https?:\/\/\S+)/.exec(text);
  if (!m) throw new Error('e-mail sem link');
  const u = new URL(m[1]!);
  return u.pathname + u.search;
}

/** Executa SQL no banco do CRM como superusuário (só preparo de dados de teste). */
export function sql(statement: string): string {
  return execFileSync('psql', [process.env.E2E_ADMIN_DATABASE_URL!, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', statement], { encoding: 'utf8' });
}

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function totp(base32: string, at = Date.now()): string {
  let bits = 0, value = 0;
  const bytes: number[] = [];
  for (const ch of base32.replace(/\s/g, '').toUpperCase()) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const mac = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const o = mac[mac.length - 1]! & 15;
  const bin = ((mac[o]! & 127) << 24) | (mac[o + 1]! << 16) | (mac[o + 2]! << 8) | mac[o + 3]!;
  return (bin % 1_000_000).toString().padStart(6, '0');
}

export async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

/** Sem violações de acessibilidade graves ou críticas (axe, WCAG 2.2 AA). */
export async function expectAccessible(page: Page): Promise<void> {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  const serious = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

export async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
}
