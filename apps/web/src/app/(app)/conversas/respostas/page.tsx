'use client';
import { useState, type FormEvent } from 'react';
import { AtSign, Mail, MessageCircle, Pencil, Plus, Trash2 } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { REPLY_VARIABLES, type Channel, type QuickReply } from '@/lib/messages';
import { useSession } from '@/components/shell/session';
import { PageHeader } from '@/components/ui/misc';
import { Panel } from '@/components/ui/panel';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Confirm } from '@/components/ui/confirm';
import { Dialog } from '@/components/ui/dialog';
import { LoadError, Loading } from '@/components/ui/states';

type Draft = { channel: Channel; shortcut: string; title: string; subject: string; body: string; shared: boolean };

export default function QuickRepliesPage() {
  const { can } = useSession();
  const { data, error, loading, reload } = useLoad(() => api<{ items: QuickReply[]; canShare: boolean }>('GET', '/api/v1/quick-replies'));
  const [tab, setTab] = useState<Channel>('whatsapp');
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [removing, setRemoving] = useState<QuickReply | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!can('conversations:reply')) return <LoadError error={new ApiError(403, 'forbidden', '')} />;
  const items = (data?.items ?? []).filter((r) => r.channel === tab);
  const canShare = data?.canShare ?? false;
  const editable = (r: QuickReply) => !r.shared || canShare;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <PageHeader title="Respostas prontas" back={{ href: '/conversas', label: 'Conversas' }}
        subtitle={<>Mensagens prontas para usar nas conversas: digite <kbd className="rounded border border-line bg-surface-2 px-1 font-mono text-[12px]">/</kbd> e o atalho na caixa de mensagem.</>}
        actions={<Button disabled={!data} onClick={() => setEditing({ id: null, draft: { channel: tab, shortcut: '', title: '', subject: '', body: '', shared: canShare } })}><Plus size={16} aria-hidden />Nova resposta</Button>} />
      {msg ? <Alert tone="success">{msg}</Alert> : null}
      {err ? <Alert tone="error">{err}</Alert> : null}
      <div role="group" aria-label="Canal" className="flex gap-1">
        {([['whatsapp', 'WhatsApp', <MessageCircle key="w" size={14} aria-hidden />], ['email', 'E-mail', <Mail key="e" size={14} aria-hidden />], ['instagram', 'Instagram', <AtSign key="i" size={14} aria-hidden />]] as const).map(([v, label, icon]) => (
          <button key={v} type="button" aria-pressed={tab === v} onClick={() => setTab(v)}
            className={`inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-sm font-medium ${tab === v ? 'bg-primary text-primary-fg' : 'border border-line text-muted hover:text-ink'}`}>{icon}{label}</button>
        ))}
      </div>
      <Panel title={tab === 'email' ? 'Respostas de e-mail' : tab === 'instagram' ? 'Respostas de Instagram' : 'Respostas de WhatsApp'}
        description={canShare ? 'As da empresa aparecem para todos; as pessoais, só para quem criou.' : 'As da empresa são mantidas pelo administrador; você pode criar as suas.'}>
        {error ? <LoadError error={error} retry={reload} /> : loading && !data ? <Loading /> : items.length === 0 ? (
          <p className="text-[13px] text-muted">Nenhuma resposta pronta {tab === 'email' ? 'de e-mail' : tab === 'instagram' ? 'de Instagram' : 'de WhatsApp'} ainda.</p>
        ) : (
          <ul className="flex flex-col">
            {items.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3 border-t border-line py-3 first:border-t-0 first:pt-0">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2"><span className="font-mono text-[13px] font-semibold">/{r.shortcut}</span><span className="font-medium">{r.title}</span>
                    {r.shared ? <Badge tone="info">Da empresa</Badge> : <Badge>Pessoal</Badge>}</p>
                  {r.subject ? <p className="text-[13px]"><span className="text-muted">Assunto:</span> {r.subject}</p> : null}
                  <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-[13px] text-muted">{r.body}</p>
                </div>
                {editable(r) ? (
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" aria-label={`Editar /${r.shortcut}`} onClick={() => setEditing({ id: r.id, draft: { channel: r.channel, shortcut: r.shortcut, title: r.title, subject: r.subject ?? '', body: r.body, shared: r.shared } })}><Pencil size={16} aria-hidden /></Button>
                    <Button variant="ghost" aria-label={`Excluir /${r.shortcut}`} onClick={() => setRemoving(r)}><Trash2 size={16} aria-hidden /></Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {editing ? <Editor initial={editing} canShare={canShare} onClose={() => setEditing(null)}
        onSaved={(m) => { setEditing(null); setMsg(m); void reload(); }} /> : null}
      <Confirm open={!!removing} title={`Excluir /${removing?.shortcut}?`} confirmLabel="Excluir"
        onConfirm={async () => {
          const r = removing!;
          setRemoving(null);
          try { await api('DELETE', `/api/v1/quick-replies/${r.id}`); setMsg('Resposta excluída.'); await reload(); } catch (e) { setErr(e instanceof ApiError ? e.title : 'Não foi possível excluir.'); }
        }}
        onCancel={() => setRemoving(null)}>
        O atalho deixa de aparecer nas conversas.
      </Confirm>
    </div>
  );
}

function Editor({ initial, canShare, onClose, onSaved }: {
  initial: { id: string | null; draft: Draft }; canShare: boolean; onClose: () => void; onSaved: (msg: string) => void;
}) {
  const [d, setD] = useState<Draft>(initial.draft);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const set = (p: Partial<Draft>) => setD((cur) => ({ ...cur, ...p }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const body = { ...d, subject: d.channel === 'email' ? d.subject : null };
      if (initial.id) await api('PATCH', `/api/v1/quick-replies/${initial.id}`, body);
      else await api('POST', '/api/v1/quick-replies', body);
      onSaved(initial.id ? 'Resposta salva.' : 'Resposta criada.');
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2 : new ApiError(0, 'error', 'Não foi possível salvar.'));
      setBusy(false);
    }
  }

  return (
    <Dialog open title={initial.id ? 'Editar resposta pronta' : 'Nova resposta pronta'} onClose={onClose} width={620}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {err && !err.errors.length ? <Alert tone="error">{err.title}</Alert> : null}
        <fieldset className="flex gap-4">
          <legend className="mb-1.5 text-[13px] font-medium">Canal</legend>
          {([['whatsapp', 'WhatsApp'], ['email', 'E-mail'], ['instagram', 'Instagram']] as const).map(([v, label]) => (
            <label key={v} className="flex min-h-11 items-center gap-2 text-sm">
              <input type="radio" name="canal-resposta" checked={d.channel === v} onChange={() => set({ channel: v })} className="size-[18px] accent-[var(--primary)]" />{label}
            </label>
          ))}
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
          <Field label="Atalho" value={d.shortcut} onChange={(e) => set({ shortcut: e.target.value.toLowerCase().replace(/\s+/g, '-') })} error={err?.fieldError('shortcut')} hint="Ex.: boasvindas" autoComplete="off" />
          <Field label="Título" value={d.title} onChange={(e) => set({ title: e.target.value })} error={err?.fieldError('title')} autoComplete="off" />
        </div>
        {d.channel === 'email' ? <Field label="Assunto" value={d.subject} onChange={(e) => set({ subject: e.target.value })} error={err?.fieldError('subject')} /> : null}
        <Textarea label="Texto" value={d.body} onChange={(e) => set({ body: e.target.value })} rows={6} error={err?.fieldError('body')} />
        <p className="text-[12px] text-muted">Variáveis: {REPLY_VARIABLES.map((v) => <code key={v.key} className="mr-2 rounded bg-surface-2 px-1" title={v.label}>{`{{${v.key}}}`}</code>)}</p>
        {canShare ? (
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" checked={d.shared} onChange={(e) => set({ shared: e.target.checked })} className="size-[18px] accent-[var(--primary)]" />
            Disponível para toda a empresa
          </label>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={busy} disabled={!d.shortcut || !d.title.trim() || !d.body.trim()}>Salvar</Button>
        </div>
      </form>
    </Dialog>
  );
}
