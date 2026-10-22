'use client';
import type { ApiError } from '@/lib/api';
import { fmtIsoDate, money, moneyInput, parseMoney, phone, type FieldDef } from '@/lib/crm';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Detail } from '@/components/ui/misc';

/** Campos personalizados no formulário. Os valores vão como a API espera. */
export function CustomFieldInputs({ defs, value, onChange, error }: {
  defs: FieldDef[]; value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void; error?: ApiError | null;
}) {
  const active = defs.filter((d) => !d.archived);
  if (!active.length) return null;
  const set = (k: string, v: unknown) => onChange({ ...value, [k]: v });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {active.map((d) => {
        const err = error?.fieldError(`custom.${d.key}`);
        const label = d.required ? `${d.label} *` : d.label;
        const v = value[d.key];
        switch (d.type) {
          case 'long_text':
            return <Textarea key={d.key} className="sm:col-span-2" label={label} value={String(v ?? '')} error={err} onChange={(e) => set(d.key, e.target.value)} />;
          case 'select':
            return (
              <Select key={d.key} label={label} value={String(v ?? '')} error={err} onChange={(e) => set(d.key, e.target.value || null)}>
                <option value="">—</option>
                {d.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            );
          case 'multi_select': {
            const list = Array.isArray(v) ? (v as string[]) : [];
            return (
              <fieldset key={d.key} className="flex flex-col gap-1.5 sm:col-span-2">
                <legend className="mb-1.5 text-[13px] font-medium">{label}</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {d.options.map((o) => (
                    <label key={o.value} className="flex min-h-9 items-center gap-2 text-sm">
                      <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={list.includes(o.value)}
                        onChange={(e) => set(d.key, e.target.checked ? [...list, o.value] : list.filter((x) => x !== o.value))} />
                      {o.label}
                    </label>
                  ))}
                </div>
                {err ? <p className="text-[13px] text-bad">{err}</p> : null}
              </fieldset>
            );
          }
          case 'boolean':
            return (
              <Select key={d.key} label={label} value={v === true ? 'true' : v === false ? 'false' : ''} error={err}
                onChange={(e) => set(d.key, e.target.value === '' ? null : e.target.value === 'true')}>
                <option value="">—</option><option value="true">Sim</option><option value="false">Não</option>
              </Select>
            );
          case 'currency':
            return <Field key={d.key} label={`${label} (R$)`} inputMode="decimal" defaultValue={moneyInput(v as number | null)} error={err}
              onChange={(e) => set(d.key, parseMoney(e.target.value))} />;
          case 'number':
            return <Field key={d.key} label={label} inputMode="decimal" value={v == null ? '' : String(v)} error={err}
              onChange={(e) => set(d.key, e.target.value === '' ? null : e.target.value)} />;
          case 'date':
            return <Field key={d.key} label={label} type="date" value={String(v ?? '')} error={err} onChange={(e) => set(d.key, e.target.value || null)} />;
          default:
            return <Field key={d.key} label={label} type={d.type === 'email' ? 'email' : d.type === 'url' ? 'url' : d.type === 'phone' ? 'tel' : 'text'}
              value={String(v ?? '')} error={err} onChange={(e) => set(d.key, e.target.value)} />;
        }
      })}
    </div>
  );
}

export function customDisplay(d: FieldDef, v: unknown): string {
  if (v === undefined || v === null || v === '') return '';
  switch (d.type) {
    case 'select': return d.options.find((o) => o.value === v)?.label ?? String(v);
    case 'multi_select': return (Array.isArray(v) ? v : [v]).map((x) => d.options.find((o) => o.value === x)?.label ?? String(x)).join(', ');
    case 'boolean': return v ? 'Sim' : 'Não';
    case 'currency': return Number.isFinite(Number(v)) ? money(Number(v)) : String(v);
    case 'date': return fmtIsoDate(String(v));
    case 'phone': return phone(String(v));
    case 'number': return Number.isFinite(Number(v)) ? Number(v).toLocaleString('pt-BR') : String(v);
    default: return typeof v === 'object' ? JSON.stringify(v) : String(v);
  }
}

export function CustomFieldValues({ defs, value }: { defs: FieldDef[]; value: Record<string, unknown> }) {
  const shown = defs.filter((d) => !d.archived || value[d.key] !== undefined);
  if (!shown.length) return null;
  return (
    <dl>
      {shown.map((d) => (
        <Detail key={d.key} label={d.label}>
          {d.type === 'url' && value[d.key]
            ? <a href={String(value[d.key])} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">{String(value[d.key])}</a>
            : customDisplay(d, value[d.key])}
        </Detail>
      ))}
    </dl>
  );
}
