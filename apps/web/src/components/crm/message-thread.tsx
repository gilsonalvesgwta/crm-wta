'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { AlertCircle, Check, CheckCheck, Clock, Download, Mail, MessageCircle, Paperclip, Send, X } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { fileSize, fmtDateTime, phone } from '@/lib/crm';
import { KIND_LABEL, STATUS_LABEL, type Message, type SendAccount } from '@/lib/messages';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';

type Target = { phones: string[]; emails: string[] };

/** Envio com arquivo: campos antes do arquivo, como a API espera. */
async function sendWithFile(contactId: string, fields: Record<string, string>, file: File): Promise<Message> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v) fd.append(k, v);
  fd.append('file', file);
  const res = await fetch(`/api/v1/contacts/${contactId}/messages/file`, { method: 'POST', credentials: 'same-origin', headers: { 'x-crm-request': '1' }, body: fd });
  const data = await res.json().catch(() => null) as (Message & { title?: string; type?: string; errors?: { field: string; message: string }[] }) | null;
  if (!res.ok) throw new ApiError(res.status, data?.type ?? 'error', res.status === 413 ? 'O arquivo é grande demais.' : data?.title ?? 'Não foi possível enviar.', data?.errors ?? []);
  return data as Message;
}

function StatusIcon({ m }: { m: Message }) {
  const label = STATUS_LABEL[m.status];
  const icon = m.status === 'queued' ? <Clock size={13} aria-hidden />
    : m.status === 'failed' ? <AlertCircle size={13} aria-hidden className="text-bad" />
    : m.status === 'read' ? <CheckCheck size={14} aria-hidden className="text-info" />
    : m.status === 'delivered' ? <CheckCheck size={14} aria-hidden />
    : m.status === 'sent' ? <Check size={14} aria-hidden /> : null;
  return icon ? <span className="inline-flex items-center gap-1" title={label}>{icon}<span className="sr-only">{label}</span></span> : null;
}

function Attachment({ file, out }: { file: NonNullable<Message['file']>; out: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const image = file.contentType.startsWith('image/');
  const audio = file.contentType.startsWith('audio/');
  useEffect(() => {
    if (!image && !audio) return;
    let alive = true;
    api<{ url: string }>('GET', `/api/v1/files/${file.id}/url`).then((r) => { if (alive) setUrl(r.url); }).catch(() => undefined);
    return () => { alive = false; };
  }, [file.id, image, audio]);
  async function open() {
    const r = await api<{ url: string }>('GET', `/api/v1/files/${file.id}/url`);
    window.open(r.url, '_blank', 'noopener');
  }
  return (
    <div className="flex flex-col gap-1.5">
      {image && url ? <img src={url} alt={file.name} className="max-h-60 max-w-full rounded-[6px] object-contain" /> : null}
      {audio && url ? <audio controls src={url} className="max-w-full"><track kind="captions" /></audio> : null}
      <button type="button" onClick={() => void open()}
        className={`flex items-center gap-2 self-start rounded-[6px] px-2 py-1 text-[13px] ${out ? 'bg-black/10' : 'bg-surface-2'} hover:underline`}>
        <Download size={14} aria-hidden /><span className="max-w-[220px] truncate">{file.name}</span><span className="opacity-70">{fileSize(file.sizeBytes)}</span>
      </button>
    </div>
  );
}

function Bubble({ m }: { m: Message }) {
  const out = m.direction === 'out';
  return (
    <li className={`flex ${out ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex max-w-[min(560px,88%)] flex-col gap-1 rounded-[10px] px-3 py-2 text-sm ${out
        ? m.status === 'failed' ? 'border border-bad bg-bad-soft text-ink' : 'bg-accent-soft text-ink'
        : 'border border-line bg-surface text-ink'}`}>
        <p className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
          {m.channel === 'email' ? <Mail size={13} aria-hidden /> : <MessageCircle size={13} aria-hidden />}
          <span>{m.channel === 'email' ? 'E-mail' : 'WhatsApp'}{m.account ? ` · ${m.account.name}` : ''}</span>
          {out ? <span>· {m.automation ? `automação "${m.automation.name}"` : m.sentBy?.name ?? 'pelo celular'}</span> : null}
        </p>
        {m.subject ? <p className="font-semibold">{m.subject}</p> : null}
        {m.file ? <Attachment file={m.file} out={out} /> : !m.body ? <p className="italic text-muted">{KIND_LABEL[m.kind] ?? 'Mensagem'}</p> : null}
        {m.body ? <p className="whitespace-pre-wrap break-words">{m.body}</p> : null}
        {m.status === 'failed' && m.error ? <p className="text-[12px] font-medium text-bad">{m.error}</p> : null}
        <p className="flex items-center justify-end gap-1.5 text-[11px] text-muted">
          <time dateTime={m.createdAt}>{fmtDateTime.format(new Date(m.createdAt))}</time>
          {out ? <StatusIcon m={m} /> : null}
          {out && m.channel === 'email' ? <span className="sr-only">para {m.remote}</span> : null}
        </p>
      </div>
    </li>
  );
}

/**
 * Histórico de mensagens de um contato (WhatsApp e e-mail) com a caixa de
 * envio. Atualiza sozinho a cada poucos segundos.
 */
export function MessageThread({ contactId, target, canSend, onActivity, height = 'h-[520px]' }: {
  contactId: string; target: Target; canSend: boolean; onActivity?: () => void; height?: string;
}) {
  const [items, setItems] = useState<Message[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<SendAccount[] | null>(null);
  const [accountId, setAccountId] = useState('');
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastCount = useRef(0);
  const activity = useRef(onActivity);
  activity.current = onActivity;

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: Message[] }>('GET', `/api/v1/contacts/${contactId}/messages`);
      setItems(r.items);
      setLoadErr(null);
      if (r.items.some((m) => m.direction === 'in' && !m.seenAt)) {
        await api('POST', `/api/v1/contacts/${contactId}/messages/seen`).catch(() => undefined);
        // O menu atualiza o número de conversas não lidas.
        window.dispatchEvent(new Event('crm-unread'));
        activity.current?.();
      }
    } catch (e) {
      setLoadErr(e instanceof ApiError ? e.title : 'Não foi possível carregar as mensagens.');
    }
  }, [contactId]);

  useEffect(() => {
    setItems(null);
    lastCount.current = 0;
    void load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 5000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!canSend) return;
    api<{ items: SendAccount[] }>('GET', '/api/v1/channels/available').then((r) => {
      setAccounts(r.items);
      const preferred = r.items.find((a) => a.kind === 'whatsapp_evolution' && target.phones.length) ?? r.items.find((a) => a.kind === 'email_smtp' && target.emails.length) ?? r.items[0];
      if (preferred) setAccountId((cur) => cur || preferred.id);
    }).catch(() => setAccounts([]));
  }, [canSend, target.phones.length, target.emails.length]);

  // Rola para a mensagem mais nova quando chega uma.
  useEffect(() => {
    if (items && items.length !== lastCount.current) {
      lastCount.current = items.length;
      list.current?.scrollTo({ top: list.current.scrollHeight });
    }
  }, [items]);

  const account = accounts?.find((a) => a.id === accountId);
  const isEmail = account?.kind === 'email_smtp';
  const options = isEmail ? target.emails : target.phones;

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!account || sending) return;
    setSending(true);
    setErr(null);
    try {
      const fields = { accountId, to: to || options[0] || '', text, subject: isEmail ? subject : '' };
      const m = file ? await sendWithFile(contactId, fields, file)
        : await api<Message>('POST', `/api/v1/contacts/${contactId}/messages`, { accountId, to: fields.to || null, text, subject: isEmail ? subject : null });
      setItems((cur) => [...(cur ?? []), m]);
      if (m.status === 'failed') setErr(new ApiError(0, 'send-failed', m.error ?? 'A mensagem não foi enviada.'));
      else { setText(''); setSubject(''); setFile(null); }
      activity.current?.();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2 : new ApiError(0, 'error', 'Não foi possível enviar.'));
    } finally {
      setSending(false);
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit();
  }

  return (
    <div className="flex flex-col">
      <ul ref={list} aria-label="Mensagens" aria-live="polite" className={`flex ${height} flex-col gap-2 overflow-y-auto bg-bg p-3`}>
        {loadErr ? <li><Alert tone="error">{loadErr}</Alert></li>
          : !items ? <li className="m-auto text-muted"><Spinner label="Carregando mensagens" /></li>
          : items.length === 0 ? <li className="m-auto max-w-xs text-center text-[13px] text-muted">Nenhuma mensagem com este contato ainda. Tudo o que for enviado ou recebido por WhatsApp e e-mail aparece aqui.</li>
          : items.map((m) => <Bubble key={m.id} m={m} />)}
      </ul>
      {canSend ? (
        accounts && accounts.length === 0 ? (
          <p className="border-t border-line px-3 py-3 text-[13px] text-muted">Nenhum WhatsApp ou e-mail conectado. O administrador conecta em Configurações › Canais.</p>
        ) : (
          <form onSubmit={submit} noValidate className="flex flex-col gap-2 border-t border-line p-3">
            {err ? <Alert tone="error">{err.fieldError('text') ?? err.fieldError('to') ?? err.fieldError('subject') ?? err.fieldError('file') ?? err.title}</Alert> : null}
            <div className="flex flex-wrap gap-2">
              <label className="sr-only" htmlFor={`canal-${contactId}`}>Enviar por</label>
              <select id={`canal-${contactId}`} value={accountId} onChange={(e) => { setAccountId(e.target.value); setTo(''); setErr(null); }}
                className="h-9 min-w-0 flex-1 rounded-[6px] border border-line-strong bg-surface px-2 text-[13px]">
                {(accounts ?? []).map((a) => (
                  <option key={a.id} value={a.id}>{a.kind === 'whatsapp_evolution' ? 'WhatsApp' : 'E-mail'} · {a.name}{a.address ? ` · ${a.kind === 'whatsapp_evolution' ? phone(a.address) : a.address}` : ''}</option>
                ))}
              </select>
              {options.length > 1 ? (
                <>
                  <label className="sr-only" htmlFor={`para-${contactId}`}>Para</label>
                  <select id={`para-${contactId}`} value={to || options[0]} onChange={(e) => setTo(e.target.value)}
                    className="h-9 min-w-0 flex-1 rounded-[6px] border border-line-strong bg-surface px-2 text-[13px]">
                    {options.map((o) => <option key={o} value={o}>{isEmail ? o : phone(o)}</option>)}
                  </select>
                </>
              ) : null}
            </div>
            {account && options.length === 0 ? (
              <p className="text-[13px] text-warn">{isEmail ? 'O contato não tem e-mail cadastrado.' : 'O contato não tem telefone cadastrado.'}</p>
            ) : null}
            {isEmail ? (
              <>
                <label className="sr-only" htmlFor={`assunto-${contactId}`}>Assunto</label>
                <input id={`assunto-${contactId}`} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Assunto" maxLength={998}
                  className="h-9 rounded-[6px] border border-line-strong bg-surface px-3 text-sm" />
              </>
            ) : null}
            <label className="sr-only" htmlFor={`texto-${contactId}`}>Mensagem</label>
            <textarea id={`texto-${contactId}`} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} rows={3}
              placeholder={isEmail ? 'Escreva o e-mail' : 'Escreva a mensagem (Ctrl+Enter envia)'}
              className="resize-y rounded-[6px] border border-line-strong bg-surface px-3 py-2 text-sm" />
            <input ref={fileInput} type="file" className="sr-only" tabIndex={-1} aria-label="Anexar arquivo à mensagem"
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <Button type="button" variant="ghost" onClick={() => fileInput.current?.click()}><Paperclip size={16} aria-hidden />Anexar</Button>
                {file ? (
                  <span className="flex min-w-0 items-center gap-1 rounded-[6px] bg-surface-2 px-2 py-1 text-[13px]">
                    <span className="truncate">{file.name}</span>
                    <button type="button" aria-label="Tirar o anexo" onClick={() => setFile(null)}><X size={14} aria-hidden /></button>
                  </span>
                ) : null}
              </div>
              <Button type="submit" loading={sending} disabled={!account || options.length === 0 || (!text.trim() && !file) || (isEmail && !subject.trim())}>
                <Send size={16} aria-hidden />Enviar
              </Button>
            </div>
          </form>
        )
      ) : null}
    </div>
  );
}
