'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { AudioLines, CalendarClock, Check, Copy, Download, FileText, Loader2, Pencil, Pin, PinOff, Plus, RotateCcw, Trash2, Upload } from 'lucide-react';
import { ApiError, api, apiUpload } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import {
  ACTIVITY_LABEL, OUTCOME_LABEL, fileSize, fmtDateTime, relative, statusBody, timelineText, type Activity, type CallOutcome, type FileItem, type Note, type TimelineEntry,
} from '@/lib/crm';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Confirm } from '@/components/ui/confirm';
import { Dialog } from '@/components/ui/dialog';
import { Empty, LoadError, Loading } from '@/components/ui/states';
import { Avatar } from '@/components/ui/misc';
import { ActivityDialog, type ActivityLinks } from './activity-dialog';
import { MediaPreview, VoiceRecorder } from './media';

export type RecordKind = 'contact' | 'organization' | 'deal' | 'lead';

// ---- Notas ------------------------------------------------------------------

export function NotesPanel({ kind, id, canEdit }: { kind: RecordKind; id: string; canEdit: boolean }) {
  const notes = useLoad(() => api<Note[]>('GET', `/api/v1/records/${kind}/${id}/notes`), [kind, id]);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [remove, setRemove] = useState<Note | null>(null);
  // Áudio gravado para a nota (ouvido antes de salvar).
  const [voice, setVoice] = useState<File | null>(null);
  const [voiceUrl, setVoiceUrl] = useState<string | null>(null);
  // Edição de uma nota já salva.
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [editErr, setEditErr] = useState<string | null>(null);
  // Transcrição: enquanto alguma nota está "transcrevendo", confere de novo a cada 5 s.
  const [transErr, setTransErr] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const pending = (notes.data ?? []).some((n) => n.transcriptStatus === 'pending' && !stalePending(n));
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => {
      api<Note[]>('GET', `/api/v1/records/${kind}/${id}/notes`).then((d) => notes.setData(d)).catch(() => undefined);
    }, 5000);
    return () => clearInterval(t);
  }, [pending, kind, id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function transcribe(n: Note) {
    setTransErr((m) => ({ ...m, [n.id]: '' }));
    try {
      const upd = await api<Note>('POST', `/api/v1/notes/${n.id}/transcribe`, {});
      notes.setData((cur) => (cur ?? []).map((x) => (x.id === n.id ? upd : x)));
    } catch (e) {
      setTransErr((m) => ({ ...m, [n.id]: e instanceof ApiError ? e.title : 'Não foi possível pedir a transcrição.' }));
    }
  }

  async function copy(n: Note) {
    try {
      await navigator.clipboard.writeText(n.transcript ?? '');
      setCopied(n.id);
      setTimeout(() => setCopied(null), 2000);
    } catch { /* sem acesso à área de transferência */ }
  }

  function setRecorded(f: File | null) {
    if (voiceUrl) URL.revokeObjectURL(voiceUrl);
    setVoice(f);
    setVoiceUrl(f ? URL.createObjectURL(f) : null);
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!body.trim() && !voice) return;
    setBusy(true);
    setErr(null);
    try {
      if (voice) {
        // Áudio primeiro; o texto, se houver, vai junto na mesma nota.
        const n = await apiUpload<Note>(`/api/v1/records/${kind}/${id}/notes/audio`, voice);
        if (body.trim()) await api('PATCH', `/api/v1/notes/${n.id}`, { body });
      } else {
        await api('POST', `/api/v1/records/${kind}/${id}/notes`, { body });
      }
      setBody('');
      setRecorded(null);
      await notes.reload();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.title : 'Não foi possível salvar a nota.');
    } finally {
      setBusy(false);
    }
  }
  async function saveEdit() {
    if (!editing || !editing.body.trim()) return;
    setEditErr(null);
    try {
      await api('PATCH', `/api/v1/notes/${editing.id}`, { body: editing.body });
      setEditing(null);
      await notes.reload();
    } catch (e2) {
      setEditErr(e2 instanceof ApiError ? e2.title : 'Não foi possível salvar.');
    }
  }
  async function pin(n: Note) {
    await api('PATCH', `/api/v1/notes/${n.id}`, { pinned: !n.pinned }).catch(() => undefined);
    await notes.reload();
  }
  async function del() {
    if (!remove) return;
    await api('DELETE', `/api/v1/notes/${remove.id}`).catch(() => undefined);
    setRemove(null);
    await notes.reload();
  }

  return (
    <Panel title="Notas">
      {canEdit ? (
        <form onSubmit={add} className="mb-4 flex flex-col gap-2">
          <label htmlFor={`nota-${id}`} className="sr-only">Nova nota</label>
          <textarea id={`nota-${id}`} value={body} onChange={(e) => setBody(e.target.value)} placeholder={voice ? 'Texto da nota (opcional)' : 'Escreva uma nota para a equipe'}
            className="min-h-[76px] rounded-[6px] border border-line-strong bg-surface px-3 py-2.5 text-sm placeholder:text-muted" />
          {voiceUrl ? (
            <div className="flex flex-wrap items-center gap-2 rounded-[8px] border border-line bg-surface-2 p-2">
              <audio controls src={voiceUrl} className="max-w-full"><track kind="captions" /></audio>
              <button type="button" onClick={() => setRecorded(null)} className="text-[13px] text-muted hover:text-bad hover:underline">Descartar áudio</button>
            </div>
          ) : null}
          {err ? <Alert tone="error">{err}</Alert> : null}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {!voice ? <VoiceRecorder onRecorded={(f) => setRecorded(f)} onError={setErr} disabled={busy} /> : null}
            <Button type="submit" loading={busy} disabled={!body.trim() && !voice}>Salvar nota</Button>
          </div>
        </form>
      ) : null}
      {notes.error ? <LoadError error={notes.error} retry={notes.reload} /> : notes.loading && !notes.data ? <Loading /> : !notes.data?.length ? (
        <p className="text-[13px] text-muted">Nenhuma nota ainda.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {notes.data.map((n) => (
            <li key={n.id} className={`rounded-[8px] border p-3 ${n.pinned ? 'border-primary/50 bg-accent-soft/40' : 'border-line'}`}>
              <div className="mb-1.5 flex items-center justify-between gap-2 text-[13px] text-muted">
                <span>{n.author?.name ?? 'Pessoa removida'} · {relative(n.createdAt)}{n.pinned ? ' · fixada' : ''}</span>
                {canEdit ? (
                  <span className="flex gap-1">
                    {(n.canEdit ?? n.mine) && editing?.id !== n.id ? (
                      <button type="button" onClick={() => { setEditing({ id: n.id, body: n.body }); setEditErr(null); }} aria-label="Editar nota"
                        className="flex size-8 items-center justify-center rounded-[6px] hover:bg-surface-2 hover:text-ink"><Pencil size={14} aria-hidden /></button>
                    ) : null}
                    <button type="button" onClick={() => pin(n)} aria-label={n.pinned ? 'Desafixar nota' : 'Fixar nota'}
                      className="flex size-8 items-center justify-center rounded-[6px] hover:bg-surface-2 hover:text-ink">
                      {n.pinned ? <PinOff size={14} aria-hidden /> : <Pin size={14} aria-hidden />}
                    </button>
                    {(n.canDelete ?? n.mine) ? (
                      <button type="button" onClick={() => setRemove(n)} aria-label="Apagar nota"
                        className="flex size-8 items-center justify-center rounded-[6px] hover:bg-surface-2 hover:text-bad"><Trash2 size={14} aria-hidden /></button>
                    ) : null}
                  </span>
                ) : null}
              </div>
              {n.audio ? <div className="mb-1.5"><MediaPreview file={n.audio} kind="audio" out={false} /></div> : null}
              {n.audio ? (
                <div className="mb-2">
                  {n.transcriptStatus === 'pending' && !stalePending(n) ? (
                    <p role="status" className="inline-flex items-center gap-2 text-[13px] text-muted">
                      <Loader2 size={14} className="animate-spin" aria-hidden />Transcrevendo o áudio…
                    </p>
                  ) : n.transcriptStatus === 'done' ? (
                    <div className="rounded-[8px] border border-line bg-surface-2 px-3 py-2.5">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-muted"><AudioLines size={13} aria-hidden />Transcrição{n.transcriptBy === 'openai' ? ' · OpenAI' : ''}</span>
                        {n.transcript ? (
                          <button type="button" onClick={() => copy(n)} className="inline-flex min-h-7 items-center gap-1 rounded-[6px] px-1.5 text-[12px] text-muted hover:bg-surface hover:text-ink">
                            {copied === n.id ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}{copied === n.id ? 'Copiado' : 'Copiar'}
                          </button>
                        ) : null}
                      </div>
                      <p className="whitespace-pre-wrap text-sm">{n.transcript || <span className="text-muted">Não foi possível entender a fala deste áudio.</span>}</p>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2 text-[13px]">
                      {n.transcriptStatus === 'failed' || stalePending(n) ? <span className="text-bad">Não foi possível transcrever.</span> : null}
                      <button type="button" onClick={() => transcribe(n)} className="inline-flex min-h-8 items-center gap-1.5 rounded-[6px] border border-line px-2.5 font-medium hover:bg-surface-2">
                        <AudioLines size={14} aria-hidden />{n.transcriptStatus === 'failed' || stalePending(n) ? 'Tentar de novo' : 'Transcrever'}
                      </button>
                    </div>
                  )}
                  {transErr[n.id] ? <p className="mt-1 text-[13px] text-bad">{transErr[n.id]}</p> : null}
                </div>
              ) : null}
              {editing?.id === n.id ? (
                <div className="flex flex-col gap-2">
                  <label htmlFor={`edit-${n.id}`} className="sr-only">Editar a nota</label>
                  <textarea id={`edit-${n.id}`} value={editing.body} onChange={(e) => setEditing({ id: n.id, body: e.target.value })} autoFocus
                    className="min-h-[76px] rounded-[6px] border border-line-strong bg-surface px-3 py-2.5 text-sm" />
                  {editErr ? <Alert tone="error">{editErr}</Alert> : null}
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
                    <Button type="button" onClick={() => void saveEdit()} disabled={!editing.body.trim()}>Salvar</Button>
                  </div>
                </div>
              ) : n.body ? <p className="whitespace-pre-wrap text-sm">{n.body}</p> : null}
            </li>
          ))}
        </ul>
      )}
      <Confirm open={!!remove} title="Apagar a nota?" confirmLabel="Apagar" onConfirm={del} onCancel={() => setRemove(null)}>
        A nota{remove?.audio ? ' e o áudio somem' : ' some'} para todos. Isso não pode ser desfeito.
      </Confirm>
    </Panel>
  );
}

// ---- Linha do tempo -------------------------------------------------------------

export function TimelinePanel({ kind, id, refreshKey = 0 }: { kind: RecordKind; id: string; refreshKey?: number }) {
  const [extra, setExtra] = useState<TimelineEntry[]>([]);
  const [more, setMore] = useState(true);
  const first = useLoad(async () => {
    const r = await api<TimelineEntry[]>('GET', `/api/v1/records/${kind}/${id}/timeline`);
    setExtra([]);
    setMore(r.length === 50);
    return r;
  }, [kind, id, refreshKey]);
  const all = [...(first.data ?? []), ...extra];

  async function loadMore() {
    const last = all.at(-1);
    if (!last) return;
    const r = await api<TimelineEntry[]>('GET', `/api/v1/records/${kind}/${id}/timeline?before=${encodeURIComponent(last.occurredAt)}`);
    setExtra([...extra, ...r]);
    setMore(r.length === 50);
  }

  return (
    <Panel title="Histórico">
      {first.error ? <LoadError error={first.error} retry={first.reload} /> : first.loading && !first.data ? <Loading /> : !all.length ? (
        <p className="text-[13px] text-muted">Sem eventos ainda.</p>
      ) : (
        <>
          <ol className="relative flex flex-col gap-3 border-l border-line pl-4">
            {all.map((e) => (
              <li key={e.id} className="relative">
                <span aria-hidden className="absolute -left-[21px] top-1.5 size-2.5 rounded-full border-2 border-surface bg-line-strong" />
                <p className="text-sm">{timelineText(e)}</p>
                <p className="text-[12px] text-muted">
                  {e.actor?.name ?? 'Sistema'} · <time dateTime={e.occurredAt} title={fmtDateTime.format(new Date(e.occurredAt))}>{relative(e.occurredAt)}</time>
                  {kind !== 'deal' && e.deal ? <> · <Link href={`/negocios/${e.deal.id}`} className="text-accent hover:underline">{e.deal.title}</Link></> : null}
                </p>
              </li>
            ))}
          </ol>
          {more ? <div className="mt-3"><Button variant="ghost" onClick={loadMore}>Ver eventos anteriores</Button></div> : null}
        </>
      )}
    </Panel>
  );
}

// ---- Arquivos --------------------------------------------------------------------------

export function FilesPanel({ kind, id, canEdit, onChange }: { kind: RecordKind; id: string; canEdit: boolean; onChange?: () => void }) {
  const files = useLoad(() => api<FileItem[]>('GET', `/api/v1/records/${kind}/${id}/files`), [kind, id]);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [remove, setRemove] = useState<FileItem | null>(null);

  async function upload(list: FileList | null) {
    const file = list?.[0];
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      await apiUpload(`/api/v1/records/${kind}/${id}/files`, file);
      await files.reload();
      onChange?.();
    } catch (e) {
      setErr(e instanceof ApiError ? e : new ApiError(0, 'error', 'Não foi possível enviar.'));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }
  async function open(f: FileItem) {
    try {
      const r = await api<{ url: string }>('GET', `/api/v1/files/${f.id}/url`);
      window.location.href = r.url;
    } catch (e) {
      setErr(e instanceof ApiError ? e : new ApiError(0, 'error', 'Não foi possível abrir.'));
    }
  }
  async function del() {
    if (!remove) return;
    await api('DELETE', `/api/v1/files/${remove.id}`).catch(() => undefined);
    setRemove(null);
    await files.reload();
    onChange?.();
  }

  return (
    <Panel title="Arquivos" actions={canEdit ? (
      <>
        <input ref={input} type="file" className="sr-only" id={`arquivo-${id}`} aria-label="Escolher arquivo para enviar" tabIndex={-1} onChange={(e) => upload(e.target.files)}
          accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.heic,.doc,.docx,.xlsx,.pptx,.odt,.ods,.csv,.txt,.zip,.mp3,.ogg,.m4a,.mp4" />
        <Button variant="secondary" loading={busy} onClick={() => input.current?.click()}><Upload size={16} aria-hidden />Enviar arquivo</Button>
      </>
    ) : undefined}>
      {err ? <div className="mb-3"><Alert tone="error">{err.errors[0]?.message ?? err.title}</Alert></div> : null}
      {files.error ? <LoadError error={files.error} retry={files.reload} /> : files.loading && !files.data ? <Loading /> : !files.data?.length ? (
        <p className="text-[13px] text-muted">Nenhum arquivo. PDF, imagens, documentos do Office, CSV e áudio de até 25 MB.</p>
      ) : (
        <ul className="flex flex-col">
          {files.data.map((f) => (
            <li key={f.id} className="flex items-center gap-3 border-t border-line py-2.5 first:border-t-0 first:pt-0">
              <FileText size={18} className="shrink-0 text-muted" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{f.originalName}</p>
                <p className="text-[12px] text-muted">{fileSize(f.sizeBytes)} · {f.uploadedBy?.name ?? ''} · {relative(f.createdAt)}</p>
              </div>
              <button type="button" onClick={() => open(f)} aria-label={`Baixar ${f.originalName}`}
                className="flex size-9 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-ink"><Download size={16} aria-hidden /></button>
              {canEdit ? (
                <button type="button" onClick={() => setRemove(f)} aria-label={`Remover ${f.originalName}`}
                  className="flex size-9 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-bad"><Trash2 size={16} aria-hidden /></button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <Confirm open={!!remove} title="Remover o arquivo?" confirmLabel="Remover" onConfirm={del} onCancel={() => setRemove(null)}>
        {remove?.originalName} deixa de estar disponível para todos.
      </Confirm>
    </Panel>
  );
}

// ---- Atividades do registro --------------------------------------------------------------

export function ActivityRow({ a, onToggle, onEdit, onDelete }: { a: Activity; onToggle: (outcome?: CallOutcome) => void; onEdit?: () => void; onDelete?: () => void }) {
  const done = a.status === 'done';
  const [asking, setAsking] = useState(false);
  // Ligação e reunião: ao concluir, pergunta como foi (entra nos indicadores comerciais).
  const isCall = a.type === 'call' || a.type === 'meeting';
  function click() {
    if (!done && isCall) setAsking((v) => !v);
    else onToggle();
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-3">
        <button type="button" onClick={click} aria-label={done ? `Reabrir: ${a.title}` : `Concluir: ${a.title}`} aria-pressed={done} aria-expanded={isCall && !done ? asking : undefined}
          className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border ${done ? 'border-ok bg-ok text-white' : 'border-line-strong hover:border-ok'}`}>
          {done ? <Check size={14} aria-hidden /> : null}
        </button>
        <div className="min-w-0 flex-1">
          {onEdit ? (
            <button type="button" onClick={onEdit} className={`text-left text-sm font-medium hover:underline ${done ? 'text-muted line-through' : ''}`}>{a.title}</button>
          ) : <p className={`text-sm font-medium ${done ? 'text-muted line-through' : ''}`}>{a.title}</p>}
          <p className="flex flex-wrap items-center gap-x-2 text-[12px] text-muted">
            <span>{ACTIVITY_LABEL[a.type]}</span>
            {a.startsAt ? <span className={a.overdue ? 'font-medium text-bad' : ''}>{a.allDay ? new Date(a.startsAt).toLocaleDateString('pt-BR') : fmtDateTime.format(new Date(a.startsAt))}{a.overdue ? ' · atrasada' : ''}</span> : <span>sem data</span>}
            {a.owner ? <span>{a.owner.name}</span> : null}
            {a.seriesId ? <span className="inline-flex items-center gap-0.5"><RotateCcw size={11} aria-hidden />repete</span> : null}
            {a.priority === 'high' ? <Badge tone="warn">Alta</Badge> : null}
            {done && a.outcome && a.outcome !== 'held' ? <Badge tone="warn">{OUTCOME_LABEL[a.outcome]}</Badge> : null}
          </p>
        </div>
        {onDelete ? (
          <button type="button" onClick={onDelete} aria-label={`Excluir: ${a.title}`}
            className="flex size-8 shrink-0 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-bad"><Trash2 size={15} aria-hidden /></button>
        ) : null}
      </div>
      {asking && !done ? (
        <div role="group" aria-label={`Como foi: ${a.title}`} className="ml-9 flex flex-wrap items-center gap-1.5 rounded-[8px] border border-line bg-surface-2 p-2">
          <span className="mr-1 text-[12px] font-medium">Como foi?</span>
          {(['held', 'no_show', 'rescheduled'] as const).map((o) => (
            <button key={o} type="button" onClick={() => { setAsking(false); onToggle(o); }}
              className={`h-8 rounded-full px-3 text-[13px] font-medium ${o === 'held' ? 'bg-primary text-primary-fg' : 'border border-line-strong bg-surface hover:bg-surface-2'}`}>{OUTCOME_LABEL[o]}</button>
          ))}
          <button type="button" onClick={() => setAsking(false)} className="h-8 px-2 text-[13px] text-muted hover:underline">Cancelar</button>
        </div>
      ) : null}
    </div>
  );
}

export function ActivitiesPanel({ filter, links, canEdit, onChange }: {
  filter: string; links: ActivityLinks; canEdit: boolean; onChange?: () => void;
}) {
  const list = useLoad(() => api<Activity[]>('GET', `/api/v1/activities?status=all&limit=100&${filter}`), [filter]);
  const [dialog, setDialog] = useState<{ activity: Activity | null } | null>(null);
  const [remove, setRemove] = useState<Activity | null>(null);
  const [removeErr, setRemoveErr] = useState<string | null>(null);
  const open = (list.data ?? []).filter((a) => a.status === 'open');
  const done = (list.data ?? []).filter((a) => a.status === 'done').slice(0, 5);

  async function toggle(a: Activity, outcome?: CallOutcome) {
    await api('POST', `/api/v1/activities/${a.id}/status`, statusBody(a, outcome)).catch(() => undefined);
    await list.reload();
    onChange?.();
  }

  async function del(scope: 'this' | 'following') {
    if (!remove) return;
    setRemoveErr(null);
    try {
      await api('DELETE', `/api/v1/activities/${remove.id}?scope=${scope}`);
      setRemove(null);
      await list.reload();
      onChange?.();
    } catch (e) {
      setRemoveErr(e instanceof ApiError ? e.title : 'Não foi possível excluir.');
    }
  }

  return (
    <Panel title="Atividades" actions={canEdit ? <Button variant="secondary" onClick={() => setDialog({ activity: null })}><Plus size={16} aria-hidden />Agendar</Button> : undefined}>
      {list.error ? (list.error.status === 403 ? <p className="text-[13px] text-muted">Seu perfil não inclui tarefas e agenda.</p> : <LoadError error={list.error} retry={list.reload} />)
        : list.loading && !list.data ? <Loading /> : !list.data?.length ? (
          <Empty title="Nada agendado">
            <span className="inline-flex items-center gap-1"><CalendarClock size={14} aria-hidden />Agende o próximo passo para não perder o ritmo.</span>
          </Empty>
        ) : (
          <div className="flex flex-col gap-3">
            {open.map((a) => <ActivityRow key={a.id} a={a} onToggle={(o) => toggle(a, o)} onEdit={canEdit ? () => setDialog({ activity: a }) : undefined} onDelete={canEdit ? () => setRemove(a) : undefined} />)}
            {done.length ? <p className="mt-1 text-[12px] font-medium uppercase tracking-wide text-muted">Concluídas</p> : null}
            {done.map((a) => <ActivityRow key={a.id} a={a} onToggle={(o) => toggle(a, o)} onDelete={canEdit ? () => setRemove(a) : undefined} />)}
          </div>
        )}
      <ActivityDialog open={!!dialog} activity={dialog?.activity} links={links} onClose={() => setDialog(null)}
        onSaved={() => { setDialog(null); void list.reload(); onChange?.(); }} />
      <Dialog open={!!remove} onClose={() => { setRemove(null); setRemoveErr(null); }} title="Excluir a atividade?" description={remove?.title}
        footer={<>
          <Button variant="ghost" onClick={() => { setRemove(null); setRemoveErr(null); }}>Cancelar</Button>
          {remove?.seriesId ? <Button variant="danger" onClick={() => void del('following')}>Esta e as próximas</Button> : null}
          <Button variant="danger" onClick={() => void del('this')}>{remove?.seriesId ? 'Só esta' : 'Excluir'}</Button>
        </>}>
        <p className="text-sm">{remove?.seriesId ? 'Ela se repete: escolha se exclui só esta ou também as próximas.' : 'Ela some da agenda de todos.'} Isso não pode ser desfeito.</p>
        {removeErr ? <div className="mt-3"><Alert tone="error">{removeErr}</Alert></div> : null}
      </Dialog>
    </Panel>
  );
}

/** "Transcrevendo" há mais de 15 minutos: o servidor reiniciou no meio; mostra "Tentar de novo". */
function stalePending(n: Note): boolean {
  return n.transcriptStatus === 'pending' && !!n.transcriptAt && Date.now() - new Date(n.transcriptAt).getTime() > 15 * 60_000;
}
