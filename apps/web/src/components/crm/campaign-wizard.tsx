'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, Mail, MessageCircle, Send, CalendarClock, Save } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { phone } from '@/lib/crm';
import { dateTime } from '@/lib/admin-types';
import { renderTemplate, type Channel, type QuickReply, type SendAccount } from '@/lib/messages';
import { CAMPAIGN_VARIABLES, emptyAudience, type Audience, type AudiencePreview, type Campaign } from '@/lib/campaigns';
import { useSession } from '@/components/shell/session';
import { useDirectory, usePipelines } from './data';
import { TagPicker } from './pickers';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';

const STEPS = ['Geral', 'Audiência', 'Conteúdo', 'Configurações', 'Revisão'] as const;

type Draft = {
  name: string; description: string; channel: Channel | ''; audience: Audience; accountId: string; subject: string; body: string;
  perMinute: number; useWindow: boolean; windowStart: string; windowEnd: string; optOutHint: boolean; when: 'now' | 'later'; scheduledAt: string;
};

function fromCampaign(c: Campaign | null): Draft {
  return {
    name: c?.name ?? '', description: c?.description ?? '', channel: c?.channel ?? '',
    audience: { ...emptyAudience(), ...(c?.audience ?? {}) }, accountId: c?.accountId ?? '', subject: c?.subject ?? '', body: c?.body ?? '',
    perMinute: c?.perMinute ?? 10, useWindow: !!c?.windowStart, windowStart: c?.windowStart ?? '08:00', windowEnd: c?.windowEnd ?? '20:00',
    optOutHint: c?.optOutHint ?? true, when: c?.scheduledAt && c.status === 'scheduled' ? 'later' : 'now',
    scheduledAt: c?.scheduledAt ? toLocalInput(new Date(c.scheduledAt)) : '',
  };
}

function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Os campos de um passo que impedem seguir, com a mensagem. */
function problems(d: Draft, step: number, preview: AudiencePreview | null): Record<string, string> {
  const e: Record<string, string> = {};
  if (step === 0) {
    if (!d.name.trim()) e.name = 'Informe o nome da campanha.';
    if (!d.channel) e.channel = 'Escolha o tipo de campanha.';
  }
  if (step === 1 && preview && preview.eligible === 0) e.audience = 'Ninguém deste público pode receber. Mude os filtros.';
  if (step === 2) {
    if (!d.accountId) e.accountId = d.channel === 'email' ? 'Escolha a conta de e-mail.' : 'Escolha o WhatsApp.';
    if (d.channel === 'email' && !d.subject.trim()) e.subject = 'Escreva o assunto.';
    if (!d.body.trim()) e.body = 'Escreva a mensagem.';
  }
  if (step === 3 && d.when === 'later' && (!d.scheduledAt || new Date(d.scheduledAt).getTime() < Date.now())) e.scheduledAt = 'Escolha uma data e hora futuras.';
  if (step === 3 && d.useWindow && (!d.windowStart || !d.windowEnd)) e.windowEnd = 'Informe o início e o fim.';
  return e;
}

export function CampaignWizard({ initial }: { initial: Campaign | null }) {
  const router = useRouter();
  const { can, me } = useSession();
  const dir = useDirectory();
  const pipelines = usePipelines();
  const [d, setD] = useState<Draft>(() => fromCampaign(initial));
  const [id, setId] = useState<string | null>(initial?.id ?? null);
  const [step, setStep] = useState(0);
  const [done, setDone] = useState<number>(initial ? 3 : 0);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [accounts, setAccounts] = useState<SendAccount[]>([]);
  const [replies, setReplies] = useState<QuickReply[]>([]);
  const [preview, setPreview] = useState<AudiencePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const set = (p: Partial<Draft>) => setD((cur) => ({ ...cur, ...p }));
  const setA = (p: Partial<Audience>) => setD((cur) => ({ ...cur, audience: { ...cur.audience, ...p } }));
  const approve = can('campaigns:approve');

  useEffect(() => {
    api<{ items: SendAccount[] }>('GET', '/api/v1/channels/available').then((r) => setAccounts(r.items)).catch(() => setAccounts([]));
    api<{ items: QuickReply[] }>('GET', '/api/v1/quick-replies').then((r) => setReplies(r.items)).catch(() => setReplies([]));
  }, []);

  // Conta da campanha: a primeira do canal, se ainda não escolhida.
  const usable = accounts.filter((a) => (d.channel === 'email') === (a.kind === 'email_smtp'));
  useEffect(() => {
    if (d.channel && !usable.some((a) => a.id === d.accountId) && usable[0]) set({ accountId: usable[0].id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.channel, accounts.length]);

  // Prévia do público a cada mudança (com uma pequena espera).
  const audienceKey = JSON.stringify([d.channel, d.audience]);
  useEffect(() => {
    if (!d.channel) return;
    setPreviewing(true);
    const t = setTimeout(() => {
      api<AudiencePreview>('POST', '/api/v1/campaigns/preview', { channel: d.channel, audience: d.audience })
        .then(setPreview).catch(() => setPreview(null)).finally(() => setPreviewing(false));
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audienceKey]);

  const errs = problems(d, step, preview);
  const pct = Math.round((done / STEPS.length) * 100);

  function body() {
    return {
      name: d.name, description: d.description || null, channel: d.channel, audience: d.audience, accountId: d.accountId || null,
      subject: d.channel === 'email' ? d.subject || null : null, body: d.body || null, perMinute: d.perMinute,
      windowStart: d.useWindow ? d.windowStart : null, windowEnd: d.useWindow ? d.windowEnd : null, optOutHint: d.optOutHint,
    };
  }

  /** Salva o rascunho (cria na primeira vez). */
  async function save(): Promise<string | null> {
    setErr(null);
    try {
      if (id) {
        await api('PATCH', `/api/v1/campaigns/${id}`, body());
        return id;
      }
      const c = await api<Campaign>('POST', '/api/v1/campaigns', body());
      setId(c.id);
      window.history.replaceState(null, '', `/campanhas/${c.id}`);
      return c.id;
    } catch (e) {
      setErr(e instanceof ApiError ? e : new ApiError(0, 'error', 'Não foi possível salvar.'));
      return null;
    }
  }

  async function next() {
    if (Object.keys(errs).length) { setShowErrors(true); return; }
    setShowErrors(false);
    setBusy('next');
    const ok = await save();
    setBusy(null);
    if (!ok) return;
    setDone((n) => Math.max(n, step + 1));
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
    window.scrollTo({ top: 0 });
  }

  async function finish(start: boolean) {
    setBusy(start ? 'start' : 'save');
    const cid = await save();
    if (!cid) { setBusy(null); return; }
    if (start) {
      try {
        await api('POST', `/api/v1/campaigns/${cid}/start`, { scheduledAt: d.when === 'later' ? new Date(d.scheduledAt).toISOString() : null });
      } catch (e) {
        setErr(e instanceof ApiError ? e : new ApiError(0, 'error', 'Não foi possível iniciar.'));
        setBusy(null);
        return;
      }
    }
    router.push(`/campanhas/${cid}${start ? '' : '?salva=1'}`);
    router.refresh();
  }

  const fieldErr = (k: string) => (showErrors ? errs[k] : undefined) ?? err?.fieldError(k);
  const tenantName = me.tenants.find((t) => t.id === me.tenantId)?.name ?? 'sua empresa';
  const sample = renderTemplate(d.body, { nome: 'Maria Souza', primeiro_nome: 'Maria', empresa: tenantName, responsavel: me.user.name });
  const stages = pipelines.data?.find((p) => p.id === d.audience.pipelineId)?.stages ?? [];
  const account = accounts.find((a) => a.id === d.accountId);

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Passos da campanha" className="rounded-[14px] border border-line bg-surface p-5 shadow-sm">
        <ol className="relative grid grid-cols-5">
          <span aria-hidden className="absolute left-[10%] right-[10%] top-5 h-px bg-line" />
          {STEPS.map((label, i) => {
            const current = i === step;
            const complete = i < done && !current;
            const reachable = i <= done;
            return (
              <li key={label} className="relative flex flex-col items-center gap-2">
                <button type="button" disabled={!reachable} onClick={() => setStep(i)} aria-current={current ? 'step' : undefined}
                  aria-label={`Passo ${i + 1}: ${label}${complete ? ' (feito)' : ''}`}
                  className={`relative z-10 flex size-10 items-center justify-center rounded-full border-2 text-sm font-semibold ${current ? 'border-primary bg-primary text-primary-fg' : complete ? 'border-primary bg-surface text-accent' : 'border-line bg-surface text-muted'} disabled:cursor-default`}>
                  {complete ? <Check size={16} aria-hidden /> : i + 1}
                </button>
                <span className={`hidden text-center text-[11px] font-semibold uppercase tracking-wide sm:block ${current ? 'text-accent' : 'text-muted'}`}>{label}</span>
              </li>
            );
          })}
        </ol>
        <div className="mt-4 flex items-end justify-between border-t border-line pt-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Visualizando passo</p>
            <p className="text-lg font-semibold uppercase">{step + 1}. {STEPS[step]}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-accent">{pct}%</p>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Completo</p>
          </div>
        </div>
      </section>

      <section aria-label={STEPS[step]} className="mx-auto flex w-full max-w-3xl flex-col gap-5">
        {err && !err.errors.length ? <Alert tone="error">{err.title}</Alert> : null}
        {err?.errors.length ? <Alert tone="error">{err.errors.map((e) => e.message).join(' ')}</Alert> : null}

        {step === 0 ? (
          <>
            <Field label="Nome *" value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="Ex.: Campanha Black Friday 2026" error={fieldErr('name')} maxLength={120} />
            <Textarea label="Descrição" value={d.description} onChange={(e) => set({ description: e.target.value })} rows={4}
              placeholder="Descreva brevemente o objetivo desta campanha…" hint="Opcional" maxLength={1000} />
            <Select label="Tipo de Campanha *" value={d.channel} onChange={(e) => set({ channel: e.target.value as Channel, accountId: '' })} error={fieldErr('channel')} className="max-w-xs">
              <option value="">Selecione o tipo</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="email">E-mail</option>
            </Select>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <p className="text-[13px] text-muted">Quem recebe: os contatos que atendem a todos os filtros abaixo. Sem filtro, todos os contatos com {d.channel === 'email' ? 'e-mail' : 'telefone'}.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <TagPicker label="Com alguma destas etiquetas" value={d.audience.tagIds} onChange={(v) => setA({ tagIds: v })} />
              <TagPicker label="Sem estas etiquetas" value={d.audience.excludeTagIds} onChange={(v) => setA({ excludeTagIds: v })} />
              <Select label="Responsável" value={d.audience.ownerIds[0] ?? ''} onChange={(e) => setA({ ownerIds: e.target.value ? [e.target.value] : [] })}>
                <option value="">Qualquer um</option>
                {(dir.data?.members ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
              <Select label="Equipe" value={d.audience.teamIds[0] ?? ''} onChange={(e) => setA({ teamIds: e.target.value ? [e.target.value] : [] })}>
                <option value="">Qualquer uma</option>
                {(dir.data?.teams ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
              <Select label="Com negócio aberto no funil" value={d.audience.pipelineId ?? ''} onChange={(e) => setA({ pipelineId: e.target.value || null, stageId: null })}>
                <option value="">Não filtrar</option>
                {(pipelines.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
              <Select label="Na etapa" value={d.audience.stageId ?? ''} onChange={(e) => setA({ stageId: e.target.value || null })} disabled={!d.audience.pipelineId}>
                <option value="">Qualquer etapa</option>
                {stages.filter((s) => s.kind === 'open').map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
              <Field label="Origem (separe por vírgula)" value={d.audience.sources.join(', ')} placeholder="google, instagram, indicação"
                onChange={(e) => setA({ sources: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
              <div className="grid grid-cols-2 gap-2">
                <Field label="Cadastrados de" type="date" value={d.audience.createdFrom ?? ''} onChange={(e) => setA({ createdFrom: e.target.value || null })} />
                <Field label="até" type="date" value={d.audience.createdTo ?? ''} onChange={(e) => setA({ createdTo: e.target.value || null })} />
              </div>
            </div>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" checked={d.audience.consentOnly} onChange={(e) => setA({ consentOnly: e.target.checked })} className="size-[18px] accent-[var(--primary)]" />
              Só quem deu consentimento para receber marketing por {d.channel === 'email' ? 'e-mail' : 'WhatsApp'}
            </label>
            <div aria-live="polite" className={`rounded-[10px] border p-4 ${fieldErr('audience') ? 'border-bad bg-bad-soft' : 'border-line bg-surface-2'}`}>
              {!preview ? <Spinner label="Calculando o público" /> : (
                <div className="flex flex-col gap-1.5 text-sm">
                  <p className="text-base"><strong className="text-2xl">{preview.eligible}</strong> contato(s) vão receber {previewing ? <span className="text-[12px] text-muted">(atualizando…)</span> : null}</p>
                  {preview.sample.length ? <p className="text-[13px] text-muted">Por exemplo: {preview.sample.join(', ')}{preview.eligible > preview.sample.length ? '…' : ''}</p> : null}
                  {preview.total > preview.eligible ? (
                    <ul className="text-[13px] text-muted">
                      {preview.noAddress ? <li>{preview.noAddress} sem {d.channel === 'email' ? 'e-mail' : 'telefone'}</li> : null}
                      {preview.suppressed ? <li>{preview.suppressed} pediram para não receber (lista de supressão)</li> : null}
                      {preview.revoked ? <li>{preview.revoked} revogaram o consentimento</li> : null}
                      {preview.noConsent ? <li>{preview.noConsent} sem consentimento registrado</li> : null}
                    </ul>
                  ) : null}
                  {fieldErr('audience') ? <p className="font-medium text-bad">{fieldErr('audience')}</p> : null}
                </div>
              )}
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            {usable.length === 0 ? <Alert tone="info">Nenhum {d.channel === 'email' ? 'e-mail' : 'WhatsApp'} conectado. O administrador conecta em Configurações › Canais.</Alert> : null}
            <Select label={d.channel === 'email' ? 'Enviar pela conta' : 'Enviar pelo número'} value={d.accountId} onChange={(e) => set({ accountId: e.target.value })} error={fieldErr('accountId')}>
              <option value="">Escolha</option>
              {usable.map((a) => <option key={a.id} value={a.id}>{a.name}{a.address ? ` · ${a.kind === 'whatsapp_evolution' ? phone(a.address) : a.address}` : ''}</option>)}
            </Select>
            {replies.some((r) => r.channel === d.channel) ? (
              <Select label="Começar de uma resposta pronta" value="" onChange={(e) => {
                const r = replies.find((x) => x.id === e.target.value);
                if (r) set({ body: r.body, subject: r.subject ?? d.subject });
              }}>
                <option value="">Escolha para copiar o texto</option>
                {replies.filter((r) => r.channel === d.channel).map((r) => <option key={r.id} value={r.id}>/{r.shortcut} · {r.title}</option>)}
              </Select>
            ) : null}
            {d.channel === 'email' ? <Field label="Assunto *" value={d.subject} onChange={(e) => set({ subject: e.target.value })} error={fieldErr('subject')} maxLength={998} /> : null}
            <Textarea label="Mensagem *" value={d.body} onChange={(e) => set({ body: e.target.value })} rows={8} error={fieldErr('body')} />
            <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
              <span>Inserir:</span>
              {CAMPAIGN_VARIABLES.map((v) => (
                <button key={v.key} type="button" onClick={() => set({ body: `${d.body}{{${v.key}}}` })} title={v.label}
                  className="rounded-full border border-line px-2 py-0.5 font-mono hover:bg-surface-2">{`{{${v.key}}}`}</button>
              ))}
            </div>
            {d.body.trim() ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium">Como chega (exemplo para Maria Souza)</span>
                <div className="rounded-[10px] bg-bg p-3">
                  <div className="ml-auto max-w-[min(480px,90%)] whitespace-pre-wrap break-words rounded-[10px] bg-accent-soft px-3 py-2 text-sm">
                    {d.channel === 'email' && d.subject ? <p className="mb-1 font-semibold">{renderTemplate(d.subject, { nome: 'Maria Souza', primeiro_nome: 'Maria', empresa: tenantName, responsavel: me.user.name })}</p> : null}
                    {sample}
                    {d.channel === 'whatsapp' && d.optOutHint ? <span className="text-muted">{'\n\n'}Para não receber mais mensagens, responda SAIR.</span> : null}
                    {d.channel === 'email' ? <span className="mt-2 block text-[12px] text-muted">Para não receber mais estes e-mails, clique aqui.</span> : null}
                  </div>
                </div>
              </div>
            ) : null}
          </>
        ) : null}

        {step === 3 ? (
          <>
            <Select label="Ritmo de envio" value={String(d.perMinute)} onChange={(e) => set({ perMinute: Number(e.target.value) })}
              className="max-w-sm">
              {[5, 10, 20, 30, 60, 120].map((n) => <option key={n} value={n}>{n} por minuto{n === 10 ? ' (recomendado para WhatsApp)' : ''}</option>)}
            </Select>
            <p className="-mt-3 text-[12px] text-muted">
              {d.channel === 'whatsapp' ? 'Mais devagar diminui o risco de o WhatsApp bloquear o número. ' : ''}
              {preview?.eligible ? `Com ${preview.eligible} contato(s), leva cerca de ${Math.max(1, Math.ceil(preview.eligible / d.perMinute))} minuto(s).` : ''}
            </p>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" checked={d.useWindow} onChange={(e) => set({ useWindow: e.target.checked })} className="size-[18px] accent-[var(--primary)]" />
              Enviar só dentro de um horário
            </label>
            {d.useWindow ? (
              <div className="grid max-w-sm grid-cols-2 gap-2">
                <Field label="Das" type="time" value={d.windowStart} onChange={(e) => set({ windowStart: e.target.value })} />
                <Field label="Às" type="time" value={d.windowEnd} onChange={(e) => set({ windowEnd: e.target.value })} error={fieldErr('windowEnd')} />
              </div>
            ) : null}
            {d.channel === 'whatsapp' ? (
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" checked={d.optOutHint} onChange={(e) => set({ optOutHint: e.target.checked })} className="size-[18px] accent-[var(--primary)]" />
                Acrescentar &ldquo;Para não receber mais mensagens, responda SAIR.&rdquo;
              </label>
            ) : <p className="text-[13px] text-muted">Os e-mails saem com o link para a pessoa sair da lista, como pede a LGPD.</p>}
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1.5 text-[13px] font-medium">Quando enviar</legend>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="radio" name="quando" checked={d.when === 'now'} onChange={() => set({ when: 'now' })} className="size-[18px] accent-[var(--primary)]" />Assim que aprovar
              </label>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="radio" name="quando" checked={d.when === 'later'} onChange={() => set({ when: 'later' })} className="size-[18px] accent-[var(--primary)]" />Agendar
              </label>
              {d.when === 'later' ? <Field label="Data e hora" type="datetime-local" value={d.scheduledAt} onChange={(e) => set({ scheduledAt: e.target.value })} error={fieldErr('scheduledAt')} className="max-w-xs" /> : null}
            </fieldset>
          </>
        ) : null}

        {step === 4 ? (
          <dl className="grid gap-x-6 gap-y-3 rounded-[10px] border border-line bg-surface p-5 text-sm sm:grid-cols-[180px_1fr]">
            <dt className="text-muted">Nome</dt><dd className="font-medium">{d.name}</dd>
            <dt className="text-muted">Canal</dt><dd className="flex items-center gap-1.5">{d.channel === 'email' ? <Mail size={14} aria-hidden /> : <MessageCircle size={14} aria-hidden />}{d.channel === 'email' ? 'E-mail' : 'WhatsApp'}{account ? ` · ${account.name}` : ''}</dd>
            <dt className="text-muted">Público</dt><dd>{preview ? `${preview.eligible} contato(s)` : '…'}</dd>
            {d.channel === 'email' ? <><dt className="text-muted">Assunto</dt><dd>{d.subject}</dd></> : null}
            <dt className="text-muted">Mensagem</dt><dd className="whitespace-pre-wrap">{d.body}</dd>
            <dt className="text-muted">Ritmo</dt><dd>{d.perMinute} por minuto{d.useWindow ? `, das ${d.windowStart} às ${d.windowEnd}` : ''}</dd>
            <dt className="text-muted">Quando</dt><dd>{d.when === 'later' && d.scheduledAt ? dateTime.format(new Date(d.scheduledAt)) : 'Assim que aprovar'}</dd>
          </dl>
        ) : null}
        {step === 4 && !approve ? <Alert tone="info">Quem aprova campanhas (administrador ou gestor) inicia o envio. Salve e avise essa pessoa.</Alert> : null}
      </section>

      <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
        <Button variant="ghost" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}><ArrowLeft size={16} aria-hidden />Voltar</Button>
        {step < STEPS.length - 1 ? (
          <Button onClick={() => void next()} loading={busy === 'next'}>Continuar<ArrowRight size={16} aria-hidden /></Button>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" loading={busy === 'save'} onClick={() => void finish(false)}><Save size={16} aria-hidden />Salvar rascunho</Button>
            {approve ? (
              <Button loading={busy === 'start'} onClick={() => void finish(true)}>
                {d.when === 'later' ? <><CalendarClock size={16} aria-hidden />Agendar envio</> : <><Send size={16} aria-hidden />Enviar agora</>}
              </Button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
