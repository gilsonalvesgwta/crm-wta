import type { FieldError } from '../http/problem.js';
import { normalizeEmail, normalizePhone } from './contact-data.js';

export type CustomFieldType =
  | 'text' | 'long_text' | 'number' | 'currency' | 'date' | 'boolean' | 'select' | 'multi_select' | 'url' | 'email' | 'phone';

export const CUSTOM_FIELD_TYPES: CustomFieldType[] = [
  'text', 'long_text', 'number', 'currency', 'date', 'boolean', 'select', 'multi_select', 'url', 'email', 'phone',
];

export type FieldDef = {
  key: string;
  label: string;
  type: CustomFieldType;
  options: { value: string; label: string }[];
  required: boolean;
  archived: boolean;
};

type Value = string | number | boolean | string[];

function empty(v: unknown): boolean {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
}

function convert(def: FieldDef, raw: unknown): { ok: true; value: Value } | { ok: false; message: string } {
  switch (def.type) {
    case 'text': {
      const s = String(raw).trim();
      return s.length <= 500 ? { ok: true, value: s } : { ok: false, message: 'Use até 500 caracteres.' };
    }
    case 'long_text': {
      const s = String(raw).trim();
      return s.length <= 10000 ? { ok: true, value: s } : { ok: false, message: 'Use até 10.000 caracteres.' };
    }
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim().replace(',', '.'));
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, message: 'Informe um número.' };
    }
    case 'currency': {
      // Valor em centavos inteiros.
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
      return Number.isSafeInteger(n) && n >= 0 ? { ok: true, value: n } : { ok: false, message: 'Informe um valor válido.' };
    }
    case 'date': {
      const s = String(raw).trim();
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
      if (!m) return { ok: false, message: 'Use o formato AAAA-MM-DD.' };
      const d = new Date(`${s}T00:00:00Z`);
      return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
        ? { ok: true, value: s } : { ok: false, message: 'Data inexistente.' };
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return { ok: true, value: raw };
      const s = String(raw).trim().toLowerCase();
      if (['sim', 's', 'true', '1', 'yes'].includes(s)) return { ok: true, value: true };
      if (['não', 'nao', 'n', 'false', '0', 'no'].includes(s)) return { ok: true, value: false };
      return { ok: false, message: 'Use sim ou não.' };
    }
    case 'select': {
      const s = String(raw).trim();
      const opt = def.options.find((o) => o.value === s || o.label.toLowerCase() === s.toLowerCase());
      return opt ? { ok: true, value: opt.value } : { ok: false, message: 'Escolha uma das opções.' };
    }
    case 'multi_select': {
      const list = Array.isArray(raw) ? raw.map(String) : String(raw).split(/[;,]/);
      const out: string[] = [];
      for (const item of list.map((x) => x.trim()).filter(Boolean)) {
        const opt = def.options.find((o) => o.value === item || o.label.toLowerCase() === item.toLowerCase());
        if (!opt) return { ok: false, message: `"${item}" não é uma das opções.` };
        if (!out.includes(opt.value)) out.push(opt.value);
      }
      return { ok: true, value: out };
    }
    case 'url': {
      const s = String(raw).trim();
      try {
        const u = new URL(s);
        return (u.protocol === 'https:' || u.protocol === 'http:') && s.length <= 2000
          ? { ok: true, value: u.toString() } : { ok: false, message: 'Use um endereço http ou https.' };
      } catch {
        return { ok: false, message: 'Endereço inválido.' };
      }
    }
    case 'email': {
      const e = normalizeEmail(String(raw));
      return e ? { ok: true, value: e } : { ok: false, message: 'E-mail inválido.' };
    }
    case 'phone': {
      const p = normalizePhone(String(raw));
      return p ? { ok: true, value: p } : { ok: false, message: 'Telefone inválido.' };
    }
  }
}

/**
 * Valida e normaliza valores de campos personalizados.
 * - Chave desconhecida ou arquivada é recusada.
 * - Valor vazio remove o campo (e é recusado se o campo for obrigatório).
 * - Na criação (`partial` falso), campo obrigatório ausente é recusado.
 * Devolve o objeto final, já mesclado com `current`.
 */
export function applyCustomFields(
  defs: FieldDef[], input: Record<string, unknown> | undefined, current: Record<string, unknown>,
  opts: { partial: boolean; prefix?: string },
): { value: Record<string, Value>; errors: FieldError[] } {
  const prefix = opts.prefix ?? 'custom';
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const out: Record<string, Value> = {};
  for (const [k, v] of Object.entries(current)) if (byKey.has(k)) out[k] = v as Value;
  const errors: FieldError[] = [];
  for (const [k, raw] of Object.entries(input ?? {})) {
    const def = byKey.get(k);
    if (!def || def.archived) {
      errors.push({ field: `${prefix}.${k}`, message: 'Campo desconhecido.' });
      continue;
    }
    if (empty(raw)) {
      delete out[k];
      continue;
    }
    const r = convert(def, raw);
    if (r.ok) out[k] = r.value;
    else errors.push({ field: `${prefix}.${k}`, message: r.message });
  }
  for (const def of defs) {
    if (!def.required || def.archived) continue;
    const touched = input && Object.prototype.hasOwnProperty.call(input, def.key);
    const already = errors.some((e) => e.field === `${prefix}.${def.key}`);
    if ((touched || !opts.partial) && empty(out[def.key]) && !already) {
      errors.push({ field: `${prefix}.${def.key}`, message: `${def.label} é obrigatório.` });
    }
  }
  return { value: out, errors };
}
