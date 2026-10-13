import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max';

/** Telefone em E.164. Sem DDI, usa o país padrão (Brasil). Inválido devolve null. */
export function normalizePhone(raw: string, country: CountryCode = 'BR'): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withPlus = /^00[1-9]/.test(trimmed) ? `+${trimmed.slice(2)}` : trimmed;
  const p = parsePhoneNumberFromString(withPlus, country);
  if (!p || !p.isValid()) return null;
  return p.number;
}

/** Telefone formatado para leitura. */
export function formatPhone(e164: string): string {
  const p = parsePhoneNumberFromString(e164);
  if (!p) return e164;
  return p.country === 'BR' ? p.formatNational() : p.formatInternational();
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function normalizeEmail(raw: string): string | null {
  const e = raw.trim().toLowerCase();
  return e.length <= 254 && EMAIL.test(e) ? e : null;
}

/** Domínio a partir de um site ou e-mail: "https://www.Exemplo.com.br/x" → "exemplo.com.br". */
export function domainOf(raw: string): string | null {
  let s = raw.trim().toLowerCase();
  if (!s) return null;
  if (s.includes('@')) s = s.split('@').pop() ?? '';
  s = s.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#:]/)[0] ?? '';
  return /^[a-z0-9.-]{3,253}$/.test(s) && s.includes('.') ? s : null;
}

/** Só dígitos (CPF, CNPJ), para comparar documentos digitados de jeitos diferentes. */
export function digits(s: string): string {
  return s.replace(/\D/g, '');
}

/** Valida dia e mês (e ano, se houver) de um aniversário. */
export function validBirthday(day: number, month: number, year?: number | null): boolean {
  if (!Number.isInteger(day) || !Number.isInteger(month) || month < 1 || month > 12 || day < 1) return false;
  const y = year ?? 2000; // ano bissexto: 29/02 sem ano é aceito
  const d = new Date(Date.UTC(y, month - 1, day));
  return d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}
