'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api';
import { phone, type Ref } from '@/lib/crm';
import type { SendAccount } from '@/lib/messages';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { EntityPicker } from './pickers';

function localInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export type ScheduledMessage = {
  id: string; channel: 'whatsapp' | 'email'; subject: string | null; body: string; sendAt: string; status: string; accountId: string | null;
  contact: { id: string; name: string };
};

/**
 * Agendar uma mensagem de WhatsApp ou e-mail para um contato (escolhido aqui
 * ou já definido), ou mudar uma agendada.
 */
export function ScheduleDialog({ open, contact, initial, defaults, onClose, onSaved }: {
  open: boolean; contact?: Ref | null; initial?: ScheduledMessage | null;
  defaults?: { accountId?: string; text?: string; subject?: string };
  onClose: () => void; onSaved: (m: ScheduledMessage) => void;
}) {
  const [who, setWho] = useState<Ref | null>(contact ?? initial?.contact ?? null);
  const [accounts, setAccounts] = useState<SendAccount[]>([]);
  const [accountId, setAccountId] = useState(initial?.accountId ?? defaults?.accountId ?? '');
  const [subject, setSubject] = useState(initial?.subject ?? defaults?.subject ?? '');
  const [text, setText] = useState(initial?.body ?? defaults?.text ?? '');
  const [when, setWhen] = useState(localInput(initial ? new Date(initial.sendAt) : new Date(Date.now() + 3600_000)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);

  useEffect(() => {
    if (!open) return;
    api<{ items: SendAccount[] }>('GET', '/api/v1/channels/available').then((r) => {
      const usable = initial ? r.items.filter((a) => (a.kind === 'email_smtp') === (initial.channel === 'email')) : r.items;
      setAccounts(usable);
      setAccountId((cur) => cur || usable[0]?.id || '');
    }).catch(() => setAccounts([]));
  }, [open, initial]);

  const isEmail = accounts.find((a) => a.id === accountId)?.kind === 'email_smtp';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const sendAt = new Date(when).toISOString();
      const m = initial
        ? await api<ScheduledMessage>('PATCH', `/api/v1/scheduled-messages/${initial.id}`, { accountId, text, subject: isEmail ? subject : null, sendAt })
        : await api<ScheduledMessage>('POST', '/api/v1/scheduled-messages', { contactId: who!.id, accountId, text, subject: isEmail ? subject : null, sendAt });
      onSaved(m);
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2 : new ApiError(0, 'error', 'Não foi possível agendar.'));
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} title={initial ? 'Mudar mensagem agendada' : 'Agendar mensagem'} onClose={onClose} width={560}
      description="A mensagem sai sozinha no dia e hora marcados, em seu nome.">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {err && !err.errors.length ? <Alert tone="error">{err.title}</Alert> : null}
        {contact || initial ? <p className="text-sm">Para <strong>{(contact ?? initial?.contact)!.name}</strong></p>
          : <EntityPicker kind="contact" label="Contato" value={who} onChange={setWho} placeholder="Digite o nome, e-mail ou telefone" />}
        <Select label="Enviar por" value={accountId} onChange={(e) => setAccountId(e.target.value)} error={err?.fieldError('accountId')}>
          {accounts.length === 0 ? <option value="">Nenhuma conta conectada</option> : null}
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.kind === 'whatsapp_evolution' ? 'WhatsApp' : 'E-mail'} · {a.name}{a.address ? ` · ${a.kind === 'whatsapp_evolution' ? phone(a.address) : a.address}` : ''}</option>)}
        </Select>
        {isEmail ? <Field label="Assunto" value={subject} onChange={(e) => setSubject(e.target.value)} error={err?.fieldError('subject')} /> : null}
        <Textarea label="Mensagem" value={text} onChange={(e) => setText(e.target.value)} rows={5} error={err?.fieldError('text')} />
        <Field label="Enviar em" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} error={err?.fieldError('sendAt')} className="max-w-xs" />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={busy} disabled={!who || !accountId || !text.trim() || !when || (isEmail && !subject.trim())}>{initial ? 'Salvar' : 'Agendar'}</Button>
        </div>
      </form>
    </Dialog>
  );
}
