'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Trash2 } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { useDirectory, usePipelines } from './data';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Loading } from '@/components/ui/states';

type Settings = {
  enabled: boolean; firstDays: number; repeatDays: number | null; maxTimes: number; sendAt: string; pipelineIds: string[]; since: string | null;
  notifyOwner: boolean; memberIds: string[]; extraPhones: string[]; whatsapp: boolean; accountId: string | null; inApp: boolean;
  alertText: string; customerText: string; saved: boolean;
};

const ALERT_VARS = [['cliente', 'Nome do cliente'], ['telefone', 'Telefone'], ['dias', 'Dias desde o fechamento'], ['negocio', 'Negócio'], ['valor', 'Valor'],
  ['data_fechamento', 'Data do fechamento'], ['responsavel', 'Responsável'], ['funil', 'Funil'], ['vez', 'Nº do aviso'], ['link', 'Link do pós-venda']] as const;
const CUSTOMER_VARS = [['primeiro_nome', 'Primeiro nome'], ['nome', 'Nome completo'], ['negocio', 'Negócio'], ['dias', 'Dias'], ['responsavel', 'Responsável'], ['empresa', 'Empresa']] as const;

/** Exemplo para a prévia dos textos. */
const SAMPLE: Record<string, string> = {
  cliente: 'Marcos Silva', telefone: '(11) 95555-1234', dias: '30', negocio: 'Carta de crédito 300 mil', valor: 'R$ 300.000,00', data_fechamento: '28/10/2026',
  responsavel: 'Ana', funil: 'Consórcio', vez: '1º', link: 'https://…/pos-venda', primeiro_nome: 'Marcos', nome: 'Marcos Silva', empresa: 'sua empresa',
};
const preview = (t: string) => t.replace(/\{\{\s*([a-zA-Z_]+)\s*(?:\|([^{}]*))?\}\}/g, (_m, k: string, alt?: string) => SAMPLE[k.toLowerCase()] ?? alt ?? '');

/** Configuração do pós-venda (padrão da empresa). */
export function AftersaleSettingsDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [s, setS] = useState<Settings | null>(null);
  const [accounts, setAccounts] = useState<{ id: string; name: string; kind: string; address: string | null }[]>([]);
  const { data: dir } = useDirectory();
  const { data: pipelines } = usePipelines();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);

  useEffect(() => {
    api<Settings>('GET', '/api/v1/aftersale/settings').then((r) => setS(r.saved ? r : { ...r, enabled: true })).catch(() => undefined);
    api<{ id: string; name: string; kind: string; address: string | null }[]>('GET', '/api/v1/conversations/accounts')
      .then((r) => setAccounts(r.filter((a) => a.kind.startsWith('whatsapp')))).catch(() => setAccounts([]));
  }, []);
  useEffect(() => {
    if (s && s.whatsapp && !s.accountId && accounts[0]) setS({ ...s, accountId: accounts[0].id });
  }, [s, accounts]);

  const set = (p: Partial<Settings>) => setS((cur) => (cur ? { ...cur, ...p } : cur));
  const fe = (k: string) => err?.fieldError(k);
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  async function save() {
    if (!s) return;
    setBusy(true);
    setErr(null);
    try {
      await api('PUT', '/api/v1/aftersale/settings', { ...s, extraPhones: s.extraPhones.filter((x) => x.trim()) });
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e : new ApiError(0, 'error', 'Não foi possível salvar.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} width={760} title="Configurar o pós-venda"
      description="Depois do negócio ganho, o CRM lembra a equipe de falar com o cliente. Vale como padrão para toda a empresa."
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button loading={busy} disabled={!s} onClick={save}>Salvar como padrão</Button></>}>
      {!s ? <Loading /> : (
        <div className="flex flex-col gap-5">
          {err ? <Alert tone="error">{err.title}{err.errors.length ? ` ${err.errors.map((x) => x.message).join(' ')}` : ''}</Alert> : null}
          <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={s.enabled} onChange={(e) => set({ enabled: e.target.checked })} className="size-[18px] accent-[var(--primary)]" />
            Avisar a equipe sobre o pós-venda
          </label>

          <fieldset className="flex flex-col gap-3 rounded-[10px] border border-line p-3">
            <legend className="px-1 text-[13px] font-semibold">Quando</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Primeiro aviso (dias depois do ganho)" type="number" min={1} value={String(s.firstDays)} error={fe('firstDays')}
                onChange={(e) => set({ firstDays: Math.max(1, Number(e.target.value) || 1) })} />
              <Field label="Repetir a cada (dias)" type="number" min={1} value={s.repeatDays == null ? '' : String(s.repeatDays)} placeholder="Não repetir" error={fe('repeatDays')}
                onChange={(e) => set({ repeatDays: e.target.value ? Math.max(1, Number(e.target.value)) : null })} />
              <Field label="Até quantos avisos" type="number" min={1} max={50} value={String(s.maxTimes)} disabled={s.repeatDays == null} error={fe('maxTimes')}
                onChange={(e) => set({ maxTimes: Math.min(50, Math.max(1, Number(e.target.value) || 1)) })} />
            </div>
            <Field className="max-w-[200px]" label="A partir de que horas" type="time" value={s.sendAt} onChange={(e) => set({ sendAt: e.target.value || '09:00' })} />
            <p className="text-[12px] text-muted">
              Exemplo com os valores acima: primeiro aviso {s.firstDays} dias depois do ganho
              {s.repeatDays ? `, depois a cada ${s.repeatDays} dias, no máximo ${s.maxTimes} avisos` : ', uma vez só'}. Os avisos param quando alguém marca “Feito”.
            </p>
          </fieldset>

          <fieldset className="flex flex-col gap-3 rounded-[10px] border border-line p-3">
            <legend className="px-1 text-[13px] font-semibold">Quais negócios</legend>
            <div>
              <p className="mb-1.5 text-[13px] font-medium">Funis <span className="font-normal text-muted">(nenhum marcado: todos)</span></p>
              <div className="flex flex-wrap gap-1.5">
                {(pipelines ?? []).filter((p) => !p.archived).map((p) => {
                  const on = s.pipelineIds.includes(p.id);
                  return <button key={p.id} type="button" aria-pressed={on} onClick={() => set({ pipelineIds: toggle(s.pipelineIds, p.id) })}
                    className={`h-8 rounded-full border px-3 text-[13px] font-medium ${on ? 'border-primary bg-accent-soft' : 'border-line bg-surface'}`}>{p.name}</button>;
                })}
              </div>
            </div>
            <Field className="max-w-[240px]" label="Só negócios ganhos a partir de" type="date" value={s.since ?? ''} onChange={(e) => set({ since: e.target.value || null })}
              hint="Evita avisar sobre toda a base antiga importada. Em branco: todos os ganhos." />
          </fieldset>

          <fieldset className="flex flex-col gap-3 rounded-[10px] border border-line p-3">
            <legend className="px-1 text-[13px] font-semibold">Quem recebe</legend>
            <label className="flex min-h-9 items-center gap-2 text-sm">
              <input type="checkbox" checked={s.notifyOwner} onChange={(e) => set({ notifyOwner: e.target.checked })} className="size-4 accent-[var(--primary)]" />
              O responsável pelo negócio (só os clientes dele)
            </label>
            <div>
              <p className="mb-1 text-[13px] font-medium">Pessoas da equipe (recebem todos)</p>
              <div className="grid max-h-44 gap-x-4 overflow-y-auto sm:grid-cols-2">
                {(dir?.members ?? []).map((m) => (
                  <label key={m.id} className="flex min-h-8 items-center gap-2 text-sm">
                    <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={s.memberIds.includes(m.id)} onChange={() => set({ memberIds: toggle(s.memberIds, m.id) })} />{m.name}
                  </label>
                ))}
              </div>
              {fe('memberIds') ? <p className="text-[13px] text-bad">{fe('memberIds')}</p> : null}
              <p className="mt-1 text-[12px] text-muted">No WhatsApp, a pessoa recebe no número de aviso cadastrado em <Link href="/configuracoes/usuarios" className="underline">Configurações › Usuários</Link>.</p>
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-[13px] font-medium">Outros números (WhatsApp)</p>
              {s.extraPhones.map((ph, i) => (
                <div key={i} className="flex items-end gap-2">
                  <Field className="max-w-[240px]" label={`Número ${i + 1}`} value={ph} placeholder="(11) 98888-7777" error={fe(`extraPhones.${i}`)}
                    onChange={(e) => set({ extraPhones: s.extraPhones.map((x, k) => (k === i ? e.target.value : x)) })} />
                  <button type="button" aria-label={`Remover número ${i + 1}`} onClick={() => set({ extraPhones: s.extraPhones.filter((_, k) => k !== i) })}
                    className="mb-1.5 flex size-9 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-bad"><Trash2 size={15} aria-hidden /></button>
                </div>
              ))}
              {s.extraPhones.length < 10 ? (
                <button type="button" onClick={() => set({ extraPhones: [...s.extraPhones, ''] })}
                  className="inline-flex h-9 items-center gap-1.5 self-start rounded-[6px] border border-line bg-surface px-3 text-[13px] font-medium hover:bg-surface-2"><Plus size={15} aria-hidden />Adicionar número</button>
              ) : null}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-3 rounded-[10px] border border-line p-3">
            <legend className="px-1 text-[13px] font-semibold">Como</legend>
            <label className="flex min-h-9 items-center gap-2 text-sm">
              <input type="checkbox" checked={s.whatsapp} onChange={(e) => set({ whatsapp: e.target.checked })} className="size-4 accent-[var(--primary)]" />Mensagem no WhatsApp
            </label>
            {s.whatsapp ? (
              <Select className="max-w-sm" label="Enviada pelo número" value={s.accountId ?? ''} error={fe('accountId')} onChange={(e) => set({ accountId: e.target.value || null })}>
                <option value="">{accounts.length ? 'Escolha o WhatsApp' : 'Nenhum WhatsApp conectado'}</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            ) : null}
            <label className="flex min-h-9 items-center gap-2 text-sm">
              <input type="checkbox" checked={s.inApp} onChange={(e) => set({ inApp: e.target.checked })} className="size-4 accent-[var(--primary)]" />Aviso no CRM (sininho), para quem é da equipe
            </label>
            {fe('whatsapp') ? <p className="text-[13px] text-bad">{fe('whatsapp')}</p> : null}
          </fieldset>

          <fieldset className="flex flex-col gap-3 rounded-[10px] border border-line p-3">
            <legend className="px-1 text-[13px] font-semibold">Textos</legend>
            <TextWithVars label="Aviso para a equipe" value={s.alertText} vars={ALERT_VARS} error={fe('alertText')} onChange={(v) => set({ alertText: v })} />
            <TextWithVars label="Mensagem sugerida para o cliente" value={s.customerText} vars={CUSTOMER_VARS} error={fe('customerText')} onChange={(v) => set({ customerText: v })}
              hint="Aparece pronta na tela de Pós-venda para enviar (dá para ajustar antes). Nome estranho no cadastro fica de fora; use {{primeiro_nome|cliente}} para uma alternativa." />
          </fieldset>
        </div>
      )}
    </Dialog>
  );
}

function TextWithVars({ label, value, vars, onChange, error, hint }: {
  label: string; value: string; vars: readonly (readonly [string, string])[]; onChange: (v: string) => void; error?: string; hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Textarea whatsapp label={label} rows={4} value={value} onChange={(e) => onChange(e.target.value)} error={error} hint={hint} />
      <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
        <span>Inserir:</span>
        {vars.map(([k, l]) => (
          <button key={k} type="button" title={l} onClick={() => onChange(`${value}{{${k}}}`)} className="rounded-full border border-line px-2 py-0.5 font-mono hover:bg-surface-2">{`{{${k}}}`}</button>
        ))}
      </div>
      <div className="rounded-[8px] bg-bg p-2.5 text-[13px]">
        <p className="mb-0.5 text-[12px] text-muted">Exemplo</p>
        <p className="whitespace-pre-wrap">{preview(value)}</p>
      </div>
    </div>
  );
}
