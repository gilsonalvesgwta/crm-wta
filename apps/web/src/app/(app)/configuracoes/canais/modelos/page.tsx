'use client';
import { Suspense, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { dateTime } from '@/lib/admin-types';
import { fillTemplate, TEMPLATE_STATUS, templateVariables, type ChannelAccount, type WaTemplate } from '@/lib/messages';
import { useSession } from '@/components/shell/session';
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

const CATEGORY: Record<WaTemplate['category'], string> = { MARKETING: 'Marketing', UTILITY: 'Utilidade', AUTHENTICATION: 'Autenticação' };

export default function TemplatesPage() {
  return <Suspense><Templates /></Suspense>;
}

function Templates() {
  const { can } = useSession();
  const search = useSearchParams();
  const accounts = useLoad(() => api<{ accounts: ChannelAccount[] }>('GET', '/api/v1/channels').then((r) => r.accounts.filter((a) => a.kind === 'whatsapp_cloud')));
  const [accountId, setAccountId] = useState(search.get('conta') ?? '');
  const acc = accounts.data?.find((a) => a.id === accountId) ?? accounts.data?.[0];
  const list = useLoad(() => (acc ? api<{ items: WaTemplate[] }>('GET', `/api/v1/whatsapp-templates?accountId=${acc.id}`) : Promise.resolve({ items: [] })), [acc?.id]);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<WaTemplate | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const edit = can('campaigns:edit');

  if (accounts.error) return <LoadError error={accounts.error} retry={accounts.reload} />;
  if (!accounts.data) return <Loading />;

  async function sync() {
    if (!acc) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ synced: number }>('POST', '/api/v1/whatsapp-templates/sync', { accountId: acc.id });
      setMsg(`${r.synced} modelo(s) atualizados com a Meta.`);
      await list.reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.title : 'Não foi possível sincronizar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Link href="/configuracoes/canais" className="inline-flex w-fit items-center gap-1 text-[13px] font-medium text-muted hover:text-ink"><ArrowLeft size={14} aria-hidden />Canais</Link>
      {msg ? <Alert tone="success">{msg}</Alert> : null}
      {err ? <Alert tone="error">{err}</Alert> : null}
      {accounts.data.length === 0 ? <Alert tone="info">Nenhum número do WhatsApp oficial. Adicione em Configurações › Canais.</Alert> : (
        <Panel title="Modelos de mensagem do WhatsApp oficial"
          description="Para começar uma conversa (ou responder depois de 24 horas) e para campanhas, o WhatsApp oficial só aceita modelos aprovados pela Meta. A aprovação costuma levar de minutos a algumas horas."
          actions={<div className="flex flex-wrap gap-2">
            <Button variant="secondary" loading={busy} onClick={() => void sync()}><RefreshCw size={16} aria-hidden />Sincronizar com a Meta</Button>
            {edit ? <Button onClick={() => setCreating(true)}><Plus size={16} aria-hidden />Novo modelo</Button> : null}
          </div>}>
          <div className="flex flex-col gap-4">
            {accounts.data.length > 1 ? (
              <Select label="Número" value={acc?.id ?? ''} onChange={(e) => setAccountId(e.target.value)} className="max-w-sm">
                {accounts.data.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            ) : null}
            {!list.data ? <Loading /> : list.data.items.length === 0 ? <p className="text-[13px] text-muted">Nenhum modelo ainda. Crie um ou sincronize os que já existem na Meta.</p> : (
              <ul className="flex flex-col">
                {list.data.items.map((t) => {
                  const st = TEMPLATE_STATUS[t.status] ?? { label: t.status, tone: 'neutral' as const };
                  return (
                    <li key={t.id} className="flex flex-wrap items-start justify-between gap-3 border-t border-line py-3 first:border-t-0 first:pt-0">
                      <div className="min-w-0 max-w-2xl">
                        <p className="flex flex-wrap items-center gap-2"><span className="font-mono text-[13px] font-semibold">{t.name}</span>
                          <Badge tone={st.tone}>{st.label}</Badge><span className="text-[12px] text-muted">{CATEGORY[t.category]} · {t.language} · {dateTime.format(new Date(t.updatedAt))}</span></p>
                        {t.header ? <p className="mt-1 text-sm font-semibold">{t.header}</p> : null}
                        <p className="whitespace-pre-wrap text-sm">{t.body}</p>
                        {t.footer ? <p className="text-[12px] text-muted">{t.footer}</p> : null}
                        {t.buttons.length ? <p className="mt-1 flex flex-wrap gap-1">{t.buttons.map((b) => <span key={b.text} className="rounded-full border border-line px-2 py-0.5 text-[12px]">{b.text}</span>)}</p> : null}
                        {t.reason ? <p className="mt-1 text-[13px] text-bad">Motivo da Meta: {t.reason}</p> : null}
                      </div>
                      {edit ? <Button variant="ghost" aria-label={`Excluir o modelo ${t.name}`} onClick={() => setRemoving(t)}><Trash2 size={16} aria-hidden /></Button> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Panel>
      )}
      {creating && acc ? <TemplateDialog accountId={acc.id} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); setMsg('Modelo enviado para a Meta aprovar.'); void list.reload(); }} /> : null}
      <Confirm open={!!removing} title={`Excluir o modelo ${removing?.name}?`} confirmLabel="Excluir"
        onConfirm={async () => {
          const t = removing!;
          setRemoving(null);
          try { await api('DELETE', `/api/v1/whatsapp-templates/${t.id}`); setMsg('Modelo excluído na Meta e no CRM.'); await list.reload(); } catch (e) { setErr(e instanceof ApiError ? e.title : 'Não foi possível excluir.'); }
        }}
        onCancel={() => setRemoving(null)}>
        O modelo é apagado também na Meta. Campanhas que usam este modelo deixam de poder sair.
      </Confirm>
    </div>
  );
}

function TemplateDialog({ accountId, onClose, onSaved }: { accountId: string; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({ name: '', category: 'MARKETING', language: 'pt_BR', header: '', body: '', footer: '', buttons: [] as string[], examples: [] as string[] });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const set = (p: Partial<typeof v>) => setV((c) => ({ ...c, ...p }));
  const n = templateVariables(v.body);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api('POST', '/api/v1/whatsapp-templates', { accountId, ...v, header: v.header || null, footer: v.footer || null, buttons: v.buttons.filter(Boolean), examples: v.examples.slice(0, n) });
      onSaved();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2 : new ApiError(0, 'error', 'Não foi possível criar.'));
      setBusy(false);
    }
  }

  return (
    <Dialog open title="Novo modelo de mensagem" description="A Meta analisa cada modelo antes de liberar o uso." onClose={onClose} width={680}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {err && !err.errors.length ? <Alert tone="error">{err.title}</Alert> : null}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Nome" value={v.name} onChange={(e) => set({ name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} placeholder="promocao_outubro"
            hint="Minúsculas, números e _." error={err?.fieldError('name')} className="sm:col-span-1" />
          <Select label="Categoria" value={v.category} onChange={(e) => set({ category: e.target.value })} error={err?.fieldError('category')}>
            <option value="MARKETING">Marketing (ofertas, novidades)</option>
            <option value="UTILITY">Utilidade (pedidos, lembretes)</option>
            <option value="AUTHENTICATION">Autenticação (códigos)</option>
          </Select>
          <Select label="Idioma" value={v.language} onChange={(e) => set({ language: e.target.value })}>
            <option value="pt_BR">Português (Brasil)</option><option value="es">Espanhol</option><option value="en_US">Inglês (EUA)</option>
          </Select>
        </div>
        <Field label="Título (opcional)" value={v.header} onChange={(e) => set({ header: e.target.value })} maxLength={60} error={err?.fieldError('header')} />
        <Textarea label="Texto" value={v.body} onChange={(e) => set({ body: e.target.value })} rows={5} maxLength={1024} error={err?.fieldError('body')}
          hint="Use {{1}}, {{2}}… onde entram os dados de cada pessoa (nome, pedido…). Não comece nem termine com variável." />
        <div className="-mt-2"><Button type="button" variant="ghost" onClick={() => set({ body: `${v.body}{{${n + 1}}}` })}><Plus size={14} aria-hidden />Inserir variável {`{{${n + 1}}}`}</Button></div>
        {n ? (
          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-1.5 text-[13px] font-medium">Exemplos das variáveis (a Meta pede para aprovar)</legend>
            {Array.from({ length: n }, (_, i) => (
              <Field key={i} label={`Exemplo de {{${i + 1}}}`} value={v.examples[i] ?? ''} placeholder={i === 0 ? 'Maria' : ''}
                onChange={(e) => { const ex = [...v.examples]; ex[i] = e.target.value; set({ examples: ex }); }} />
            ))}
            {err?.fieldError('examples') ? <p className="text-[13px] text-bad sm:col-span-2">{err.fieldError('examples')}</p> : null}
          </fieldset>
        ) : null}
        <Field label="Rodapé (opcional)" value={v.footer} onChange={(e) => set({ footer: e.target.value })} maxLength={60} error={err?.fieldError('footer')} />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-[13px] font-medium">Botões de resposta rápida (até 3, opcional)</legend>
          {v.buttons.map((b, i) => (
            <div key={i} className="flex items-end gap-2">
              <Field label={`Botão ${i + 1}`} value={b} maxLength={25} onChange={(e) => { const bs = [...v.buttons]; bs[i] = e.target.value; set({ buttons: bs }); }} className="flex-1" />
              <Button type="button" variant="ghost" aria-label={`Tirar o botão ${i + 1}`} onClick={() => set({ buttons: v.buttons.filter((_, j) => j !== i) })} className="mb-0.5"><Trash2 size={16} aria-hidden /></Button>
            </div>
          ))}
          {v.buttons.length < 3 ? <Button type="button" variant="ghost" className="self-start" onClick={() => set({ buttons: [...v.buttons, ''] })}><Plus size={14} aria-hidden />Botão</Button> : null}
        </fieldset>
        {v.body.trim() ? (
          <div className="rounded-[10px] bg-bg p-3">
            <p className="mb-1.5 text-[12px] font-medium text-muted">Como chega</p>
            <div className="max-w-[420px] rounded-[10px] bg-surface px-3 py-2 text-sm shadow-sm">
              {v.header ? <p className="font-semibold">{v.header}</p> : null}
              <p className="whitespace-pre-wrap">{fillTemplate(v.body, v.examples)}</p>
              {v.footer ? <p className="mt-1 text-[12px] text-muted">{v.footer}</p> : null}
              {v.buttons.filter(Boolean).map((b) => <p key={b} className="mt-1.5 border-t border-line pt-1.5 text-center text-[13px] font-medium text-accent">{b}</p>)}
            </div>
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={busy} disabled={!v.name || !v.body.trim()}>Enviar para aprovação</Button>
        </div>
      </form>
    </Dialog>
  );
}
