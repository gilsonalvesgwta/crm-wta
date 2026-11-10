// Limpeza de dados vindos de planilhas e de outros CRMs (Pipedrive, RD Station,
// HubSpot…): telefones em qualquer formato, e-mails de preenchimento ("não
// possuo") e valores em reais.
import { parsePhoneNumberFromString } from 'libphonenumber-js';

/** DDDs válidos no Brasil. */
const DDD = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

/**
 * Número nacional do Brasil (DDD + número), com o 9 dos celulares antigos
 * (8 dígitos começando com 6 a 9) acrescentado. Nulo se não parece do Brasil.
 */
function brNational(d: string): string | null {
  if (!DDD.has(Number(d.slice(0, 2)))) return null;
  const n = d.slice(2);
  if (n.length === 9 && n[0] === '9') return d;
  if (n.length === 8 && /[2-5]/.test(n[0]!)) return d; // fixo
  if (n.length === 8 && /[6-9]/.test(n[0]!)) return `${d.slice(0, 2)}9${n}`; // celular sem o 9
  return null;
}

function valid(e164: string): string | null {
  const p = parsePhoneNumberFromString(e164);
  return p && p.isValid() ? p.number : null;
}

/** Um telefone no formato internacional (+DDI…), ou nulo. */
export function cleanPhone(raw: string): string | null {
  let s = raw.trim().replace(/^['"`´]+|['"`´]+$/g, '').trim();
  if (!s) return null;
  if (/^00[1-9]/.test(s.replace(/\s/g, ''))) s = `+${s.replace(/\s/g, '').slice(2)}`;
  const plus = s.startsWith('+');
  let d = s.replace(/\D/g, '');
  // Número colado duas vezes (acontece em exportações): fica uma.
  if (d.length > 15 && d.length % 2 === 0 && d.slice(0, d.length / 2) === d.slice(d.length / 2)) d = d.slice(0, d.length / 2);
  if (d.length < 8 || d.length > 15) return null;
  // Brasil com o 55 na frente (com ou sem +).
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
    const n = brNational(d.slice(2));
    if (n) return valid(`+55${n}`);
  }
  if (plus) return valid(`+${d}`);
  // Sem código do país: Brasil quando tem cara de Brasil (DDD + 8 ou 9 dígitos)…
  const national = d.length === 12 && d.startsWith('0') ? d.slice(1) : d.length === 11 && d.startsWith('0') ? null : d;
  if (national && (national.length === 10 || national.length === 11)) {
    const n = brNational(national);
    if (n) return valid(`+55${n}`);
  }
  // …senão, o código do país já está no começo (o Pipedrive exporta assim: "1 (774) 606-6570", "351 960 480 788").
  return valid(`+${d}`);
}

/** Todos os telefones de uma célula ("55 11 9…, 55 11 9…"), sem repetir. */
export function cleanPhones(raw: string | null | undefined): { phones: string[]; invalid: string[] } {
  const phones: string[] = [];
  const invalid: string[] = [];
  for (const part of (raw ?? '').split(/[,;|/]|\s{3,}|\n/)) {
    if (!part.trim()) continue;
    const p = cleanPhone(part);
    if (p) { if (!phones.includes(p)) phones.push(p); } else invalid.push(part.trim());
  }
  return { phones, invalid };
}

const PLACEHOLDER_LOCAL = /^(nao|n|sem|semm?email|sememail|naopossuo|naopossui|naotenho|naotem|naoinformado|naoinformou|nenhum|none|noemail|nomail|null|na|nd|xx+|x|teste?|test|email|e-?mail|exemplo|example|sn|semnome|nome|cliente|contato|a|aa+|asd|qwe|123|1234)$/;
const PLACEHOLDER_DOMAIN = /^(email\.com|teste\.com|test\.com|exemplo\.com|example\.com|x\.com|xx\.com|naotem\.com|sem\.com|nao\.com|a\.com)$/;

/** E-mail de preenchimento, como "naopossuo@gmail.com" ou "teste@teste.com". */
export function isPlaceholderEmail(email: string): boolean {
  const [local = '', domain = ''] = email.toLowerCase().split('@');
  const l = local.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[._-]/g, '');
  return PLACEHOLDER_LOCAL.test(l) || PLACEHOLDER_DOMAIN.test(domain);
}

/**
 * Valor em reais para centavos: "547812.9", "1.200.000,50", "R$ 1.500", "1,500.00".
 * Nulo se não é um número.
 */
export function moneyToCents(raw: string | null | undefined): number | null {
  let s = (raw ?? '').replace(/[R$\s]|BRL|USD|EUR/gi, '');
  if (!s) return null;
  const neg = s.startsWith('-');
  s = s.replace(/^-/, '');
  if (!/^[\d.,]+$/.test(s)) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let int: string;
  let frac = '';
  if (lastComma > lastDot) {
    // vírgula decimal (padrão brasileiro), pontos de milhar
    [int, frac] = [s.slice(0, lastComma).replace(/\./g, ''), s.slice(lastComma + 1)];
    if (frac.length === 3 && lastDot === -1 && !s.slice(0, lastComma).includes(',')) { int += frac; frac = ''; } // "1,500" = mil e quinhentos
  } else if (lastDot > lastComma) {
    const after = s.slice(lastDot + 1);
    // "1.500" ou "1.200.000" (milhar) × "547812.9" (decimal)
    if (after.length === 3 && (s.match(/\./g)!.length > 1 || lastComma !== -1 || s.slice(0, lastDot).length <= 3)) {
      int = s.replace(/[.,]/g, '');
    } else {
      [int, frac] = [s.slice(0, lastDot).replace(/,/g, ''), after];
    }
  } else {
    int = s;
  }
  if (!/^\d+$/.test(int || '0') || !/^\d*$/.test(frac)) return null;
  const cents = Number(int || '0') * 100 + Math.round(Number(`0.${frac || '0'}`) * 100);
  return Number.isSafeInteger(cents) ? (neg ? -cents : cents) : null;
}

/** Data de planilha: "2026-10-12", "12/10/2026", "12/10/26". */
export function parseSheetDate(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  let y: number, mo: number, d: number;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s))) {
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (y < 100) y += 2000;
  } else return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
