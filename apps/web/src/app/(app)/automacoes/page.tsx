'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, History, Paperclip, Pencil, Plus, Trash2, X, Zap } from 'lucide-react';
import { ApiError, api, apiUpload } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { dateTime } from '@/lib/admin-types';
import type { SendAccount } from '@/lib/messages';
import { useSession } from '@/components/shell/session';
import { usePipelines, useTags } from '@/components/crm/data';
import { Panel } from '@/components/ui/panel';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Confirm } from '@/components/ui/confirm';
import { Dialog } from '@/components/ui/dialog';
import { LoadError, Loading } from '@/components/ui/states';
import { PageHeader } from '@/components/ui/misc';

type Trigger =
  | { type: 'contact.created' | 'lead.created' | 'deal.created' | 'deal.won' | 'deal.lost' | 'message.received' }
  | { type: 'deal.stage_changed'; stageId?: string | null }
  | { type: 'birthday'; time: string }
  | { type: 'deal.inactive'; days: number };
type Action =
  | { type: 'send_whatsapp'; accountId: string; text: string }
  | { type: 'send_email'; accountId: string; subject: string; text: string }
  | { type: 'create_task'; title: string; dueInDays: number; activityType: string }
  | { type: 'add_tag'; tagId: string }
  | { type: 'move_stage'; stageId: string }
  | { type: 'webhook'; url: string }
  | { type: 'wait'; minutes: number }
  | {
    type: 'notify_team'; membershipIds: string[]; phones: string[]; emails: string[]; whatsappAccountId: string | null; emailAccountId: string | null;
    subject: string; text: string; fileIds: string[];
  };
type Filters = { pipelineId?: string | null; stageId?: string | null; tagId?: string | null; source?: string | null };
type Rule = {
  id: string; name: string; active: boolean; trigger: Trigger; filters: Filters; actions: Action[];
  stats: { total: number; failed: number; lastRunAt: string | null };
};
type Draft = { name: string; active: boolean; trigger: Trigger; filters: Filters; actions: Action[] };
type Run = {
  id: string; ruleName: string; status: 'pending' | 'waiting' | 'running' | 'done' | 'failed' | 'skipped'; error: string | null;
  createdAt: string; nextAt: string; contact: { id: string; name: string } | null; deal: { id: string; title: string } | null;
  log: { at: string; action: string; ok: boolean; detail: string }[];
};

const TRIGGERS: { type: Trigger['type']; label: string }[] = [
  { type: 'contact.created', label: 'Contato novo' },
  { type: 'lead.created', label: 'Lead novo' },
  { type: 'deal.created', label: 'Negócio novo' },
  { type: 'deal.stage_changed', label: 'Negócio muda de etapa' },
  { type: 'deal.won', label: 'Negócio ganho' },
  { type: 'deal.lost', label: 'Negócio perdido' },
  { type: 'deal.inactive', label: 'Negócio parado há alguns dias (follow-up)' },
  { type: 'message.received', label: 'Mensagem de WhatsApp recebida' },
  { type: 'birthday', label: 'Aniversário do contato' },
];
const ACTIONS: { type: Action['type']; label: string }[] = [
  { type: 'send_whatsapp', label: 'Enviar WhatsApp' },
  { type: 'send_email', label: 'Enviar e-mail' },
  { type: 'create_task', label: 'Criar tarefa ou lembrete' },
  { type: 'add_tag', label: 'Pôr etiqueta no contato' },
  { type: 'move_stage', label: 'Mover o negócio de etapa' },
  { type: 'notify_team', label: 'Avisar a equipe (WhatsApp ou e-mail)' },
  { type: 'webhook', label: 'Avisar o n8n (webhook)' },
  { type: 'wait', label: 'Esperar' },
];
const RUN_STATUS: Record<Run['status'], { label: string; tone: 'ok' | 'warn' | 'bad' | 'neutral' | 'info' }> = {
  pending: { label: 'Na fila', tone: 'neutral' }, waiting: { label: 'Esperando', tone: 'info' }, running: { label: 'Rodando', tone: 'info' },
  done: { label: 'Concluída', tone: 'ok' }, failed: { label: 'Falhou', tone: 'bad' }, skipped: { label: 'Não se aplicou', tone: 'neutral' },
};
const label = (list: { type: string; label: string }[], t: string) => list.find((x) => x.type === t)?.label ?? t;

const TEMPLATES: { title: string; draft: (ids: { wa?: string; mail?: string }) => Draft }[] = [
  {
    title: 'Boas-vindas por WhatsApp a cada contato novo',
    draft: ({ wa }) => ({ name: 'Boas-vindas', active: true, trigger: { type: 'contact.created' }, filters: {},
      actions: [{ type: 'send_whatsapp', accountId: wa ?? '', text: 'Olá, {{primeiro_nome}}! Aqui é da {{empresa}}. Como podemos ajudar?' }] }),
  },
  {
    title: 'Parabéns no aniversário',
    draft: ({ wa }) => ({ name: 'Parabéns', active: true, trigger: { type: 'birthday', time: '09:00' }, filters: {},
      actions: [{ type: 'send_whatsapp', accountId: wa ?? '', text: 'Feliz aniversário, {{primeiro_nome}}! Um abraço de toda a equipe da {{empresa}}.' }] }),
  },
  {
    title: 'Follow-up de negócio parado',
    draft: () => ({ name: 'Follow-up', active: true, trigger: { type: 'deal.inactive', days: 3 }, filters: {},
      actions: [{ type: 'create_task', title: 'Retomar contato: {{negocio}}', dueInDays: 0, activityType: 'call' }] }),
  },
  {
    title: 'Lembrete depois de enviar proposta',
    draft: ({ mail }) => ({ name: 'Proposta enviada', active: true, trigger: { type: 'deal.stage_changed', stageId: null }, filters: {},
      actions: [{ type: 'wait', minutes: 2880 }, { type: 'send_email', accountId: mail ?? '', subject: 'Sobre a proposta, {{primeiro_nome}}', text: 'Olá, {{primeiro_nome}}.\nConseguiu ver a proposta de {{negocio}}? Fico à disposição.\n{{responsavel}}' }] }),
  },
];

function blank(): Draft {
  return { name: '', active: true, trigger: { type: 'contact.created' }, filters: {}, actions: [{ type: 'create_task', title: '', dueInDays: 0, activityType: 'task' }] };
}

function newAction(type: Action['type']): Action {
  switch (type) {
    case 'send_whatsapp': return { type, accountId: '', text: '' };
    case 'send_email': return { type, accountId: '', subject: '', text: '' };
    case 'create_task': return { type, title: '', dueInDays: 0, activityType: 'task' };
    case 'add_tag': return { type, tagId: '' };
    case 'move_stage': return { type, stageId: '' };
    case 'webhook': return { type, url: '' };
    case 'wait': return { type, minutes: 60 };
    case 'notify_team': return {
      type, membershipIds: [], phones: [], emails: [], whatsappAccountId: null, emailAccountId: null,
      subject: 'Aviso: {{negocio}}', text: 'O negócio {{negocio}} ({{valor}}) de {{nome}} está em {{etapa}}.\nAbrir no CRM: {{link}}', fileIds: [],
    };
  }
}

function waitText(min: number): string {
  if (min % 1440 === 0) return `${min / 1440} dia(s)`;
  if (min % 60 === 0) return `${min / 60} hora(s)`;
  return `${min} min`;
}

export default function AutomationsPage() {
  const { can } = useSession();
  if (!can('automations:view')) return <LoadError error={new ApiError(403, 'forbidden', '')} />;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader title="Automações" subtitle="Mensagens, tarefas e avisos que o CRM faz sozinho." />
      <Automations />
    </div>
  );
}

function Automations() {
  const { can } = useSession();
  const { data, error, loading, reload } = useLoad(() => api<{ items: Rule[]; variables: { key: string; label: string }[] }>('GET', '/api/v1/automations'));
  const runs = useLoad(() => api<Run[]>('GET', '/api/v1/automations/runs'));
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [removing, setRemoving] = useState<Rule | null>(null);
  const [accounts, setAccounts] = useState<SendAccount[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const admin = can('automations:admin');

  useEffect(() => {
    api<{ items: SendAccount[] }>('GET', '/api/v1/channels/available').then((r) => setAccounts(r.items)).catch(() => setAccounts([]));
  }, []);

  if (loading && !data) return <Loading />;
  if (error) return <LoadError error={error} retry={reload} />;
  const wa = (accounts.find((a) => a.kind === 'whatsapp_evolution') ?? accounts.find((a) => a.kind === 'whatsapp_cloud'))?.id;
  const mail = accounts.find((a) => a.kind === 'email_smtp')?.id;

  async function toggle(r: Rule) {
    setErr(null);
    try {
      await api('PATCH', `/api/v1/automations/${r.id}`, { active: !r.active });
      await reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.title : 'Não foi possível alterar.');
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {msg ? <Alert tone="success">{msg}</Alert> : null}
      {err ? <Alert tone="error">{err}</Alert> : null}
      <Panel title="Regras" description="Quando algo acontece (contato novo, negócio muda de etapa, aniversário…), o CRM faz sozinho: manda WhatsApp ou e-mail, cria tarefa, põe etiqueta, avisa o n8n."
        actions={admin ? <Button onClick={() => setEditing({ id: null, draft: blank() })}><Plus size={16} aria-hidden />Nova automação</Button> : undefined}>
        {data!.items.length === 0 ? (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-muted">Nenhuma automação ainda. Comece por um modelo:</p>
            {admin ? (
              <ul className="grid gap-2 sm:grid-cols-2">
                {TEMPLATES.map((t) => (
                  <li key={t.title}>
                    <button type="button" onClick={() => setEditing({ id: null, draft: t.draft({ wa, mail }) })}
                      className="flex w-full items-center gap-2 rounded-[8px] border border-line p-3 text-left text-sm hover:bg-surface-2">
                      <Zap size={16} aria-hidden className="shrink-0 text-accent" />{t.title}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <ul className="flex flex-col">
            {data!.items.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-3 first:border-t-0 first:pt-0">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium">{r.name} {r.active ? <Badge tone="ok">Ligada</Badge> : <Badge>Desligada</Badge>}</p>
                  <p className="text-[13px] text-muted">
                    Quando: {label(TRIGGERS, r.trigger.type)}{r.trigger.type === 'deal.inactive' ? ` (${r.trigger.days} dias)` : ''}{r.trigger.type === 'birthday' ? ` às ${r.trigger.time}` : ''}
                    {' · '}Faz: {r.actions.map((a) => (a.type === 'wait' ? `esperar ${waitText(a.minutes)}` : label(ACTIONS, a.type).toLowerCase())).join(', depois ')}
                  </p>
                  <p className="text-[12px] text-muted">
                    {r.stats.total} execuções em 30 dias{r.stats.failed ? `, ${r.stats.failed} com falha` : ''}{r.stats.lastRunAt ? ` · última ${dateTime.format(new Date(r.stats.lastRunAt))}` : ''}
                  </p>
                </div>
                {admin ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex min-h-10 items-center gap-2 text-[13px]">
                      <input type="checkbox" checked={r.active} onChange={() => void toggle(r)} className="size-[18px] accent-[var(--primary)]" />
                      Ligada<span className="sr-only">: {r.name}</span>
                    </label>
                    <Button variant="secondary" aria-label={`Editar ${r.name}`} onClick={() => setEditing({ id: r.id, draft: { name: r.name, active: r.active, trigger: r.trigger, filters: r.filters ?? {}, actions: r.actions } })}>
                      <Pencil size={16} aria-hidden />
                    </Button>
                    <Button variant="ghost" aria-label={`Excluir ${r.name}`} onClick={() => setRemoving(r)}><Trash2 size={16} aria-hidden /></Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Últimas execuções" description="O que cada automação fez, contato por contato."
        actions={<Button variant="secondary" onClick={() => { void runs.reload(); void reload(); }}><History size={16} aria-hidden />Atualizar</Button>}>
        {!runs.data ? <Loading /> : runs.data.length === 0 ? <p className="text-[13px] text-muted">Nenhuma execução ainda.</p> : (
          <ul className="flex flex-col">
            {runs.data.slice(0, 50).map((r) => (
              <li key={r.id} className="border-t border-line py-2.5 first:border-t-0 first:pt-0">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{r.ruleName}</span>
                  <Badge tone={RUN_STATUS[r.status].tone}>{RUN_STATUS[r.status].label}</Badge>
                  <span className="text-[13px] text-muted">{dateTime.format(new Date(r.createdAt))}{r.contact ? ` · ${r.contact.name}` : ''}{r.deal ? ` · ${r.deal.title}` : ''}</span>
                </p>
                {r.status === 'waiting' ? <p className="text-[13px] text-muted">Continua em {dateTime.format(new Date(r.nextAt))}.</p> : null}
                {r.error ? <p className={`text-[13px] ${r.status === 'failed' ? 'text-bad' : 'text-muted'}`}>{r.error}</p> : null}
                {r.log.length ? <p className="text-[12px] text-muted">{r.log.map((l) => `${l.ok ? '✓' : '✗'} ${l.detail}`).join(' · ')}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {editing ? (
        <RuleDialog id={editing.id} initial={editing.draft} accounts={accounts} variables={data!.variables} onClose={() => setEditing(null)}
          onSaved={(m) => { setEditing(null); setMsg(m); void reload(); }} />
      ) : null}
      <Confirm open={!!removing} title={`Excluir ${removing?.name}?`} confirmLabel="Excluir"
        onConfirm={async () => {
          const r = removing!;
          setRemoving(null);
          try { await api('DELETE', `/api/v1/automations/${r.id}`); setMsg('Automação excluída.'); await reload(); } catch (e) { setErr(e instanceof ApiError ? e.title : 'Não foi possível excluir.'); }
        }}
        onCancel={() => setRemoving(null)}>
        A automação para e o histórico das execuções dela é apagado.
      </Confirm>
    </div>
  );
}

function RuleDialog({ id, initial, accounts, variables, onClose, onSaved }: {
  id: string | null; initial: Draft; accounts: SendAccount[]; variables: { key: string; label: string }[];
  onClose: () => void; onSaved: (msg: string) => void;
}) {
  const [d, setD] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const { data: pipelines } = usePipelines();
  const { data: tags } = useTags();
  const allStages = (pipelines ?? []).flatMap((p) => p.stages.map((s) => ({ ...s, pipeline: p.name, pipelineId: p.id })));
  const isDeal = d.trigger.type.startsWith('deal.');

  const setAction = (i: number, a: Action) => setD({ ...d, actions: d.actions.map((x, j) => (j === i ? a : x)) });
  const move = (i: number, by: number) => {
    const list = [...d.actions];
    const [a] = list.splice(i, 1);
    list.splice(i + by, 0, a!);
    setD({ ...d, actions: list });
  };
  const fieldErr = (prefix: string) => err?.errors.filter((e) => e.field === prefix || e.field.startsWith(`${prefix}.`)).map((e) => e.message).join(' ');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const clean = (f: Filters) => Object.fromEntries(Object.entries(f).filter(([, v]) => v)) as Filters;
    try {
      const body = { ...d, filters: clean(d.filters) };
      if (id) await api('PUT', `/api/v1/automations/${id}`, body);
      else await api('POST', '/api/v1/automations', body);
      onSaved(id ? 'Automação salva.' : 'Automação criada. Ela age a partir de agora.');
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2 : new ApiError(0, 'error', 'Não foi possível salvar.'));
      setBusy(false);
    }
  }

  return (
    <Dialog open title={id ? 'Editar automação' : 'Nova automação'} onClose={onClose} width={760}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        {err && err.errors.length === 0 ? <Alert tone="error">{err.title}</Alert> : null}
        {err && err.errors.length > 0 ? <Alert tone="error">{err.title} {err.errors.map((e) => e.message).join(' ')}</Alert> : null}
        <Field label="Nome" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="Ex.: Boas-vindas" maxLength={120} />

        <fieldset className="flex flex-col gap-3 rounded-[8px] border border-line p-4">
          <legend className="px-1 font-semibold">1. Quando</legend>
          <Select label="Acontecimento" value={d.trigger.type}
            onChange={(e) => {
              const t = e.target.value as Trigger['type'];
              const trigger: Trigger = t === 'birthday' ? { type: t, time: '09:00' } : t === 'deal.inactive' ? { type: t, days: 3 } : t === 'deal.stage_changed' ? { type: t, stageId: null } : { type: t } as Trigger;
              setD({ ...d, trigger, actions: t.startsWith('deal.') ? d.actions : d.actions.filter((a) => a.type !== 'move_stage') });
            }}>
            {TRIGGERS.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
          </Select>
          {d.trigger.type === 'deal.stage_changed' ? (
            <Select label="Etapa de destino" value={d.trigger.stageId ?? ''} onChange={(e) => setD({ ...d, trigger: { type: 'deal.stage_changed', stageId: e.target.value || null } })}>
              <option value="">Qualquer etapa</option>
              {allStages.map((s) => <option key={s.id} value={s.id}>{s.pipeline} › {s.name}</option>)}
            </Select>
          ) : null}
          {d.trigger.type === 'birthday' ? (
            <Field label="Horário do envio" type="time" value={d.trigger.time} onChange={(e) => setD({ ...d, trigger: { type: 'birthday', time: e.target.value } })}
              hint="No fuso da empresa. Contato nascido em 29/2 recebe no dia 28 nos anos que não são bissextos." />
          ) : null}
          {d.trigger.type === 'deal.inactive' ? (
            <Field label="Dias sem atividade" type="number" min={1} max={365} value={String(d.trigger.days)}
              onChange={(e) => setD({ ...d, trigger: { type: 'deal.inactive', days: Number(e.target.value) || 1 } })}
              hint="Conta desde a última nota, tarefa ou mensagem do negócio. Age uma vez a cada período parado." />
          ) : null}
          {d.trigger.type === 'message.received' ? <p className="text-[13px] text-muted">Para não virar conversa entre robôs, responde o mesmo contato no máximo a cada 12 horas.</p> : null}
          <details className="text-sm">
            <summary className="cursor-pointer text-[13px] font-medium text-accent">Só para alguns (filtros)</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Select label="Funil" value={d.filters.pipelineId ?? ''} onChange={(e) => setD({ ...d, filters: { ...d.filters, pipelineId: e.target.value || null, stageId: null } })}>
                <option value="">Qualquer funil</option>
                {(pipelines ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
              <Select label="Etapa atual" value={d.filters.stageId ?? ''} onChange={(e) => setD({ ...d, filters: { ...d.filters, stageId: e.target.value || null } })}>
                <option value="">Qualquer etapa</option>
                {allStages.filter((s) => !d.filters.pipelineId || s.pipelineId === d.filters.pipelineId).map((s) => <option key={s.id} value={s.id}>{s.pipeline} › {s.name}</option>)}
              </Select>
              <Select label="Contato com a etiqueta" value={d.filters.tagId ?? ''} onChange={(e) => setD({ ...d, filters: { ...d.filters, tagId: e.target.value || null } })}>
                <option value="">Qualquer contato</option>
                {(tags ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
              <Field label="Origem" value={d.filters.source ?? ''} onChange={(e) => setD({ ...d, filters: { ...d.filters, source: e.target.value } })} placeholder="Ex.: site, instagram" />
            </div>
          </details>
        </fieldset>

        <fieldset className="flex flex-col gap-3 rounded-[8px] border border-line p-4">
          <legend className="px-1 font-semibold">2. Fazer, nesta ordem</legend>
          <p className="text-[13px] text-muted">
            Nos textos, use {variables.map((v) => <code key={v.key} title={v.label} className="mx-0.5 rounded bg-surface-2 px-1 text-[12px]">{`{{${v.key}}}`}</code>)}.
          </p>
          <ol className="flex flex-col gap-3">
            {d.actions.map((a, i) => (
              <li key={i} className="flex flex-col gap-3 rounded-[8px] bg-surface-2 p-3">
                <div className="flex flex-wrap items-end gap-2">
                  <Select label={`Ação ${i + 1}`} className="min-w-0 flex-1" value={a.type} onChange={(e) => setAction(i, newAction(e.target.value as Action['type']))}>
                    {ACTIONS.filter((x) => x.type !== 'move_stage' || isDeal).map((x) => <option key={x.type} value={x.type}>{x.label}</option>)}
                  </Select>
                  <Button type="button" variant="ghost" aria-label={`Subir a ação ${i + 1}`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={16} aria-hidden /></Button>
                  <Button type="button" variant="ghost" aria-label={`Descer a ação ${i + 1}`} disabled={i === d.actions.length - 1} onClick={() => move(i, 1)}><ArrowDown size={16} aria-hidden /></Button>
                  <Button type="button" variant="ghost" aria-label={`Tirar a ação ${i + 1}`} disabled={d.actions.length === 1} onClick={() => setD({ ...d, actions: d.actions.filter((_, j) => j !== i) })}><Trash2 size={16} aria-hidden /></Button>
                </div>
                <ActionFields a={a} onChange={(x) => setAction(i, x)} accounts={accounts} tags={tags ?? []} stages={allStages} />
                {fieldErr(`actions.${i}`) ? <p className="text-[13px] text-bad">{fieldErr(`actions.${i}`)}</p> : null}
              </li>
            ))}
          </ol>
          {d.actions.length < 20 ? (
            <Button type="button" variant="secondary" className="self-start" onClick={() => setD({ ...d, actions: [...d.actions, newAction('wait')] })}>
              <Plus size={16} aria-hidden />Mais uma ação
            </Button>
          ) : null}
        </fieldset>

        <label className="flex min-h-11 items-center gap-2.5">
          <input type="checkbox" checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} className="size-[18px] accent-[var(--primary)]" />
          Ligada (age sobre o que acontecer a partir de agora)
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={busy} disabled={!d.name.trim()}>{id ? 'Salvar' : 'Criar automação'}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function ActionFields({ a, onChange, accounts, tags, stages }: {
  a: Action; onChange: (a: Action) => void; accounts: SendAccount[]; tags: { id: string; name: string }[];
  stages: { id: string; name: string; pipeline: string; kind: string }[];
}) {
  switch (a.type) {
    case 'send_whatsapp':
    case 'send_email': {
      const list = accounts.filter((x) => (a.type === 'send_whatsapp' ? x.kind === 'whatsapp_evolution' || x.kind === 'whatsapp_cloud' : x.kind === 'email_smtp'));
      return (
        <div className="flex flex-col gap-3">
          <Select label={a.type === 'send_whatsapp' ? 'Número' : 'Caixa de e-mail'} value={a.accountId} onChange={(e) => onChange({ ...a, accountId: e.target.value })}>
            <option value="">{list.length ? 'Escolha' : 'Nenhum conectado (Configurações › Canais)'}</option>
            {list.map((x) => <option key={x.id} value={x.id}>{x.name}{x.address ? ` · ${x.address}` : ''}</option>)}
          </Select>
          {a.type === 'send_email' ? <Field label="Assunto" value={a.subject} onChange={(e) => onChange({ ...a, subject: e.target.value })} /> : null}
          <Textarea label="Texto" rows={3} value={a.text} onChange={(e) => onChange({ ...a, text: e.target.value })} />
        </div>
      );
    }
    case 'create_task':
      return (
        <div className="grid gap-3 sm:grid-cols-[1fr_140px_160px]">
          <Field label="Título da tarefa" value={a.title} onChange={(e) => onChange({ ...a, title: e.target.value })} placeholder="Ligar para {{nome}}" />
          <Field label="Para daqui a (dias)" type="number" min={0} max={365} value={String(a.dueInDays)} onChange={(e) => onChange({ ...a, dueInDays: Number(e.target.value) || 0 })} />
          <Select label="Tipo" value={a.activityType} onChange={(e) => onChange({ ...a, activityType: e.target.value })}>
            <option value="task">Tarefa</option><option value="call">Ligação</option><option value="meeting">Reunião</option>
            <option value="email">E-mail</option><option value="visit">Visita</option><option value="other">Outro</option>
          </Select>
        </div>
      );
    case 'add_tag':
      return (
        <Select label="Etiqueta" value={a.tagId} onChange={(e) => onChange({ ...a, tagId: e.target.value })}>
          <option value="">Escolha</option>
          {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
      );
    case 'move_stage':
      return (
        <Select label="Para a etapa" value={a.stageId} onChange={(e) => onChange({ ...a, stageId: e.target.value })}>
          <option value="">Escolha</option>
          {stages.filter((s) => s.kind === 'open').map((s) => <option key={s.id} value={s.id}>{s.pipeline} › {s.name}</option>)}
        </Select>
      );
    case 'notify_team':
      return <NotifyTeamFields a={a} onChange={onChange} accounts={accounts} />;
    case 'webhook':
      return <Field label="Endereço do webhook (n8n)" value={a.url} onChange={(e) => onChange({ ...a, url: e.target.value })} placeholder="https://n8n.suaempresa.com.br/webhook/..." hint="O CRM manda um POST com o evento, o contato e o negócio em JSON." />;
    case 'wait':
      return (
        <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
          <Field label="Quanto" type="number" min={1} value={String(a.minutes % 1440 === 0 ? a.minutes / 1440 : a.minutes % 60 === 0 ? a.minutes / 60 : a.minutes)}
            onChange={(e) => {
              const n = Math.max(1, Number(e.target.value) || 1);
              const unit = a.minutes % 1440 === 0 ? 1440 : a.minutes % 60 === 0 ? 60 : 1;
              onChange({ ...a, minutes: n * unit });
            }} />
          <Select label="Unidade" value={a.minutes % 1440 === 0 ? '1440' : a.minutes % 60 === 0 ? '60' : '1'}
            onChange={(e) => {
              const unit = Number(e.target.value);
              const cur = a.minutes % 1440 === 0 ? a.minutes / 1440 : a.minutes % 60 === 0 ? a.minutes / 60 : a.minutes;
              onChange({ ...a, minutes: cur * unit });
            }}>
            <option value="1">minutos</option><option value="60">horas</option><option value="1440">dias</option>
          </Select>
        </div>
      );
  }
}

/** Avisar a equipe: quem recebe, por onde (WhatsApp e/ou e-mail), texto e anexos. */
function NotifyTeamFields({ a, onChange, accounts }: { a: Extract<Action, { type: 'notify_team' }>; onChange: (a: Action) => void; accounts: SendAccount[] }) {
  const members = useLoad(() => api<{ items: { membershipId: string; name: string; email: string; status: string; notifyPhone: string | null }[] }>('GET', '/api/v1/members').then((r) => r.items.filter((m) => m.status === 'active')).catch(() => []));
  const files = useLoad(() => api<{ items: { id: string; name: string; contentType: string; size: number }[] }>('GET', '/api/v1/automations/files').then((r) => r.items));
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [upErr, setUpErr] = useState<string | null>(null);
  const [extraPhones, setExtraPhones] = useState(a.phones.join(', '));
  const [extraEmails, setExtraEmails] = useState(a.emails.join(', '));
  const was = accounts.filter((x) => x.kind === 'whatsapp_evolution' || x.kind === 'whatsapp_cloud');
  const mails = accounts.filter((x) => x.kind === 'email_smtp');
  const toggle = (id: string) => onChange({ ...a, membershipIds: a.membershipIds.includes(id) ? a.membershipIds.filter((x) => x !== id) : [...a.membershipIds, id] });
  const split = (v: string) => v.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
  const noPhone = a.whatsappAccountId ? (members.data ?? []).filter((m) => a.membershipIds.includes(m.membershipId) && !m.notifyPhone) : [];
  async function upload(f: File) {
    setBusy(true);
    setUpErr(null);
    try {
      const m = await apiUpload<{ id: string }>('/api/v1/automations/files', f);
      onChange({ ...a, fileIds: [...a.fileIds, m.id].slice(0, 5) });
      await files.reload();
    } catch (e) {
      setUpErr(e instanceof ApiError ? e.errors[0]?.message ?? e.title : 'Não foi possível enviar.');
    } finally {
      setBusy(false);
    }
  }
  const selected = a.fileIds.map((id) => files.data?.find((f) => f.id === id) ?? { id, name: 'Arquivo', contentType: '', size: 0 });
  return (
    <div className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-[13px] font-medium">Quem recebe</legend>
        {!members.data ? <p className="text-[13px] text-muted">Carregando a equipe…</p> : (
          <div className="grid gap-1 sm:grid-cols-2">
            {members.data.map((m) => (
              <label key={m.membershipId} className="flex items-center gap-2 rounded-[6px] border border-line px-2.5 py-1.5 text-[13px]">
                <input type="checkbox" checked={a.membershipIds.includes(m.membershipId)} onChange={() => toggle(m.membershipId)} className="size-4 accent-[var(--primary)]" />
                <span className="min-w-0 flex-1 truncate">{m.name}</span>
                <span className="shrink-0 text-[11px] text-muted">{m.notifyPhone ? 'WhatsApp ✓' : 'sem WhatsApp'}</span>
              </label>
            ))}
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Outros WhatsApp (opcional)" value={extraPhones} placeholder="47 99999-0000, 11 98888-7777"
            onChange={(e) => { setExtraPhones(e.target.value); onChange({ ...a, phones: split(e.target.value).slice(0, 10) }); }} />
          <Field label="Outros e-mails (opcional)" value={extraEmails} placeholder="financeiro@empresa.com"
            onChange={(e) => { setExtraEmails(e.target.value); onChange({ ...a, emails: split(e.target.value).slice(0, 10) }); }} />
        </div>
      </fieldset>
      <div className="grid gap-2 sm:grid-cols-2">
        <Select label="Avisar por WhatsApp, pelo número" value={a.whatsappAccountId ?? ''} onChange={(e) => onChange({ ...a, whatsappAccountId: e.target.value || null })}>
          <option value="">Não avisar por WhatsApp</option>
          {was.map((x) => <option key={x.id} value={x.id}>{x.name}{x.address ? ` · ${x.address}` : ''}</option>)}
        </Select>
        <Select label="Avisar por e-mail, pela caixa" value={a.emailAccountId ?? ''} onChange={(e) => onChange({ ...a, emailAccountId: e.target.value || null })}>
          <option value="">Não avisar por e-mail</option>
          {mails.map((x) => <option key={x.id} value={x.id}>{x.name}{x.address ? ` · ${x.address}` : ''}</option>)}
        </Select>
      </div>
      {noPhone.length ? (
        <Alert tone="warning">Sem WhatsApp cadastrado: {noPhone.map((m) => m.name).join(', ')}. Cadastre em Configurações › Usuários{a.emailAccountId ? ' (por e-mail essas pessoas recebem)' : ''}.</Alert>
      ) : null}
      {a.whatsappAccountId && was.find((x) => x.id === a.whatsappAccountId)?.kind === 'whatsapp_cloud' ? (
        <p className="text-[12px] text-muted">Pela API oficial, o aviso só chega para quem mandou mensagem a esse número nas últimas 24 horas. Para avisos da equipe, prefira um número conectado por QR code.</p>
      ) : null}
      {a.emailAccountId ? <Field label="Assunto do e-mail" value={a.subject} onChange={(e) => onChange({ ...a, subject: e.target.value })} /> : null}
      <Textarea label="Aviso" rows={4} value={a.text} onChange={(e) => onChange({ ...a, text: e.target.value })} hint="Use {{negocio}}, {{valor}}, {{nome}}, {{link}}…" />
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">Anexos (até 5: PDF, imagem, vídeo, áudio)</span>
        <div className="flex flex-wrap gap-1.5">
          {selected.map((f) => (
            <span key={f.id} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-surface-2 pl-3 pr-1 text-[13px]">
              <Paperclip size={13} aria-hidden /><span className="max-w-[200px] truncate">{f.name}</span>
              <button type="button" aria-label={`Tirar ${f.name}`} onClick={() => onChange({ ...a, fileIds: a.fileIds.filter((x) => x !== f.id) })}
                className="flex size-6 items-center justify-center rounded-full hover:bg-surface"><X size={12} aria-hidden /></button>
            </span>
          ))}
        </div>
        {a.fileIds.length < 5 ? (
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileInput} type="file" className="hidden" aria-label="Anexo do aviso" accept="application/pdf,image/jpeg,image/png,video/mp4,video/quicktime,audio/mp4,audio/x-m4a,audio/aac,audio/wav"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
            <Button type="button" variant="secondary" loading={busy} onClick={() => fileInput.current?.click()}><Paperclip size={15} aria-hidden />Anexar arquivo</Button>
            {(files.data ?? []).filter((f) => !a.fileIds.includes(f.id)).length ? (
              <select aria-label="Escolher anexo da biblioteca" value="" onChange={(e) => { if (e.target.value) onChange({ ...a, fileIds: [...a.fileIds, e.target.value].slice(0, 5) }); }}
                className="h-10 min-w-0 flex-1 rounded-[6px] border border-line-strong bg-surface px-3 text-sm">
                <option value="">Ou escolha da biblioteca de mídia…</option>
                {(files.data ?? []).filter((f) => !a.fileIds.includes(f.id)).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            ) : null}
          </div>
        ) : null}
        {upErr ? <p className="text-[13px] text-bad">{upErr}</p> : null}
      </div>
    </div>
  );
}
