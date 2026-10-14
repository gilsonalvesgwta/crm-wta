'use client';
import { useState, type FormEvent } from 'react';
import { Mail, MessageCircle } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import type { Ref } from '@/lib/crm';
import type { Channel, Conversation } from '@/lib/messages';
import { useSession } from '@/components/shell/session';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { EntityPicker } from './pickers';

/** Abre a conversa (ou acha a que já existe) com um contato num canal. */
export async function startConversation(contactId: string, channel: Channel): Promise<Conversation> {
  return api<Conversation>('POST', '/api/v1/conversations', { contactId, channel });
}

/**
 * Nova conversa: com um contato já cadastrado ou com alguém novo (nome e
 * telefone ou e-mail), mesmo sem nenhuma mensagem antes.
 */
export function NewConversationDialog({ open, onClose, onStarted }: {
  open: boolean; onClose: () => void; onStarted: (c: Conversation) => void;
}) {
  const { can } = useSession();
  const [channel, setChannel] = useState<Channel>('whatsapp');
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [contact, setContact] = useState<Ref | null>(null);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const canCreate = can('contacts:edit');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      let contactId = contact?.id ?? null;
      if (mode === 'new') {
        const [first, ...rest] = name.trim().split(/\s+/);
        const body = channel === 'whatsapp'
          ? { firstName: first, lastName: rest.join(' ') || null, phones: [{ number: address }] }
          : { firstName: first, lastName: rest.join(' ') || null, emails: [{ email: address }] };
        try {
          contactId = (await api<{ id: string }>('POST', '/api/v1/contacts', body)).id;
        } catch (e2) {
          // Já existe alguém com esse número ou e-mail que você vê: usa o cadastro dele.
          const dup = e2 instanceof ApiError && e2.status === 409
            ? (e2.body as { duplicates?: { id: string; visible: boolean }[] } | undefined)?.duplicates?.find((d) => d.visible) : undefined;
          if (!dup) throw e2;
          contactId = dup.id;
        }
      }
      if (!contactId) return;
      onStarted(await startConversation(contactId, channel));
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2 : new ApiError(0, 'error', 'Não foi possível abrir a conversa.'));
    } finally {
      setBusy(false);
    }
  }

  const ready = mode === 'existing' ? !!contact : !!name.trim() && !!address.trim();
  const fieldErr = err?.fieldError('phones.0.number') ?? err?.fieldError('emails.0.email') ?? err?.fieldError('channel');
  return (
    <Dialog open={open} title="Nova conversa" description="Mande a primeira mensagem para quem ainda não falou com a empresa." onClose={onClose} width={520}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {err && !fieldErr ? <Alert tone="error">{err.fieldError('firstName') ?? err.title}</Alert> : null}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-[13px] font-medium">Canal</legend>
          <div className="flex gap-2">
            {([['whatsapp', 'WhatsApp', <MessageCircle key="w" size={16} aria-hidden />], ['email', 'E-mail', <Mail key="e" size={16} aria-hidden />]] as const).map(([v, label, icon]) => (
              <label key={v} className={`flex h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-[6px] border text-sm font-medium ${channel === v ? 'border-primary bg-accent-soft' : 'border-line-strong'}`}>
                <input type="radio" name="canal" value={v} checked={channel === v} onChange={() => { setChannel(v); setAddress(''); setErr(null); }} className="sr-only" />
                {icon}{label}
              </label>
            ))}
          </div>
        </fieldset>
        {canCreate ? (
          <div role="group" aria-label="Para quem" className="flex gap-1">
            {([['existing', 'Contato cadastrado'], ['new', 'Contato novo']] as const).map(([v, label]) => (
              <button key={v} type="button" aria-pressed={mode === v} onClick={() => { setMode(v); setErr(null); }}
                className={`h-8 rounded-full px-3 text-[13px] font-medium ${mode === v ? 'bg-primary text-primary-fg' : 'border border-line text-muted hover:text-ink'}`}>{label}</button>
            ))}
          </div>
        ) : null}
        {mode === 'existing' ? (
          <EntityPicker kind="contact" label="Contato" value={contact} onChange={setContact} placeholder="Digite o nome, e-mail ou telefone" />
        ) : (
          <>
            <Field label="Nome" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
            <Field label={channel === 'whatsapp' ? 'WhatsApp (com DDD)' : 'E-mail'} value={address} onChange={(e) => setAddress(e.target.value)}
              type={channel === 'whatsapp' ? 'tel' : 'email'} inputMode={channel === 'whatsapp' ? 'tel' : 'email'} autoComplete="off"
              placeholder={channel === 'whatsapp' ? '(11) 98765-4321' : 'nome@empresa.com.br'} error={fieldErr} />
          </>
        )}
        {mode === 'existing' && fieldErr ? <Alert tone="error">{fieldErr}</Alert> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={busy} disabled={!ready}>Abrir conversa</Button>
        </div>
      </form>
    </Dialog>
  );
}
