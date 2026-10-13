'use client';
import { useState, type FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import type { FieldDef } from '@/lib/crm';
import { useFields } from '@/components/crm/data';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Dialog } from '@/components/ui/dialog';
import { Loading } from '@/components/ui/states';

const ENTITY = { contact: 'Contatos', organization: 'Organizações', deal: 'Negócios', lead: 'Leads' } as const;
const TYPE: Record<FieldDef['type'], string> = {
  text: 'Texto curto', long_text: 'Texto longo', number: 'Número', currency: 'Valor em R$', date: 'Data', boolean: 'Sim ou não',
  select: 'Lista (uma opção)', multi_select: 'Lista (várias opções)', url: 'Endereço web', email: 'E-mail', phone: 'Telefone',
};

function slug(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'c_$1').slice(0, 40);
}

export default function FieldsSettings() {
  const { data, refresh } = useFields();
  const [entity, setEntity] = useState<FieldDef['entity']>('contact');
  const [dialog, setDialog] = useState<FieldDef | 'new' | null>(null);
  if (!data) return <Loading />;
  const list = data.filter((f) => f.entity === entity);

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Registro" className="flex flex-wrap gap-1">
        {(Object.keys(ENTITY) as FieldDef['entity'][]).map((e) => (
          <button key={e} type="button" aria-pressed={entity === e} onClick={() => setEntity(e)}
            className={`h-9 rounded-full border px-3.5 text-sm font-medium ${entity === e ? 'border-primary bg-accent-soft' : 'border-line bg-surface text-muted hover:text-ink'}`}>{ENTITY[e]}</button>
        ))}
      </nav>
      <Panel title={`Campos de ${ENTITY[entity].toLowerCase()}`} description="Campos próprios da empresa, além dos padrões. Aparecem nos formulários, nas fichas, na importação e na exportação."
        actions={<Button onClick={() => setDialog('new')}><Plus size={16} aria-hidden />Novo campo</Button>}>
        {!list.length ? <p className="text-[13px] text-muted">Nenhum campo personalizado.</p> : (
          <ul className="flex flex-col">
            {list.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2.5 first:border-t-0 first:pt-0">
                <div>
                  <p className="font-medium">{f.label} {f.required ? <span className="text-bad" aria-label="obrigatório">*</span> : null}</p>
                  <p className="text-[13px] text-muted">{TYPE[f.type]} · chave <code className="font-mono text-[12px]">{f.key}</code>{f.options.length ? ` · ${f.options.map((o) => o.label).join(', ')}` : ''}</p>
                </div>
                <div className="flex items-center gap-2">
                  {f.archived ? <Badge>Arquivado</Badge> : null}
                  <Button variant="ghost" onClick={() => setDialog(f)}>Editar</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Dialog open={!!dialog} onClose={() => setDialog(null)} title={dialog === 'new' ? 'Novo campo' : 'Editar campo'}>
        {dialog ? <FieldForm entity={entity} field={dialog === 'new' ? null : dialog} onDone={async () => { await refresh(); setDialog(null); }} onCancel={() => setDialog(null)} /> : null}
      </Dialog>
    </div>
  );
}

function FieldForm({ entity, field, onDone, onCancel }: { entity: FieldDef['entity']; field: FieldDef | null; onDone: () => Promise<void>; onCancel: () => void }) {
  const [label, setLabel] = useState(field?.label ?? '');
  const [key, setKey] = useState(field?.key ?? '');
  const [keyTouched, setKeyTouched] = useState(!!field);
  const [type, setType] = useState<FieldDef['type']>(field?.type ?? 'text');
  const [required, setRequired] = useState(field?.required ?? false);
  const [options, setOptions] = useState(field?.options ?? []);
  const [archived, setArchived] = useState(field?.archived ?? false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const list = type === 'select' || type === 'multi_select';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const opts = options.filter((o) => o.label.trim()).map((o) => ({ value: o.value || slug(o.label), label: o.label.trim() }));
    try {
      if (field) await api('PATCH', `/api/v1/custom-fields/${field.id}`, { label, required, archived, ...(list ? { options: opts } : {}) });
      else await api('POST', '/api/v1/custom-fields', { entity, key, label, type, required, ...(list ? { options: opts } : {}) });
      await onDone();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2 : null);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {err ? <Alert tone="error">{err.title} {err.errors.map((x) => x.message).join(' ')}</Alert> : null}
      <Field label="Rótulo" value={label} onChange={(e) => { setLabel(e.target.value); if (!keyTouched) setKey(slug(e.target.value)); }} required />
      {!field ? (
        <>
          <Field label="Chave" value={key} onChange={(e) => { setKey(e.target.value); setKeyTouched(true); }} error={err?.fieldError('key')}
            hint="Nome técnico, usado na API, no n8n e na importação. Não muda depois." />
          <Select label="Tipo" value={type} onChange={(e) => setType(e.target.value as FieldDef['type'])}>
            {Object.entries(TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </>
      ) : <p className="text-[13px] text-muted">Tipo: {TYPE[field.type]} · chave {field.key}. Tipo e chave não mudam, para não invalidar os valores já gravados.</p>}
      {list ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-medium">Opções</legend>
          {options.map((o, i) => (
            <div key={i} className="flex gap-2">
              <input aria-label={`Opção ${i + 1}`} value={o.label} onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className="h-10 flex-1 rounded-[6px] border border-line-strong bg-surface px-3 text-sm" />
              {!field?.options.some((x) => x.value === o.value) ? (
                <button type="button" aria-label={`Remover opção ${i + 1}`} onClick={() => setOptions(options.filter((_, j) => j !== i))} className="flex size-10 items-center justify-center rounded-[6px] text-muted hover:text-bad"><Trash2 size={16} aria-hidden /></button>
              ) : null}
            </div>
          ))}
          <button type="button" onClick={() => setOptions([...options, { value: '', label: '' }])} className="inline-flex w-fit items-center gap-1 text-[13px] font-medium text-accent"><Plus size={14} aria-hidden />Adicionar opção</button>
          {field ? <p className="text-[13px] text-muted">Opções já usadas podem ser renomeadas, não removidas.</p> : null}
        </fieldset>
      ) : null}
      <label className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={required} onChange={(e) => setRequired(e.target.checked)} />Obrigatório</label>
      {field ? <label className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={archived} onChange={(e) => setArchived(e.target.checked)} />Arquivado (some dos formulários; os valores ficam)</label> : null}
      <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button><Button type="submit" loading={busy} disabled={!label.trim() || (!field && !key)}>Salvar</Button></div>
    </form>
  );
}
