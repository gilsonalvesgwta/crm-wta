'use client';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Plus, Trash2 } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { phone, type Contact, type Duplicate, type Ref } from '@/lib/crm';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { CustomFieldInputs } from './custom-fields';
import { useFields } from './data';
import { EntityPicker, MemberSelect, TagPicker } from './pickers';

type EmailRow = { email: string; label: 'work' | 'personal' | 'other' };
type PhoneRow = { number: string; label: 'mobile' | 'whatsapp' | 'work' | 'home' | 'other' };
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export function ContactDialog({ open, contact, organization, onClose, onSaved }: {
  open: boolean; contact?: Contact | null; organization?: Ref | null; onClose: () => void; onSaved: (c: Contact) => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={contact ? 'Editar contato' : 'Novo contato'} width={680}>
      <ContactForm contact={contact ?? null} organization={organization ?? null} onSaved={onSaved} onCancel={onClose} />
    </Dialog>
  );
}

function ContactForm({ contact, organization, onSaved, onCancel }: {
  contact: Contact | null; organization: Ref | null; onSaved: (c: Contact) => void; onCancel: () => void;
}) {
  const { data: defs } = useFields('contact');
  const [firstName, setFirstName] = useState(contact?.firstName ?? '');
  const [lastName, setLastName] = useState(contact?.lastName ?? '');
  const [jobTitle, setJobTitle] = useState(contact?.jobTitle ?? '');
  const [org, setOrg] = useState<Ref | null>(contact?.organization ?? organization);
  const [emails, setEmails] = useState<EmailRow[]>(contact?.emails.map((e) => ({ email: e.email, label: e.label as EmailRow['label'] })) ?? [{ email: '', label: 'work' }]);
  const [phones, setPhones] = useState<PhoneRow[]>(contact?.phones.map((p) => ({ number: phone(p.number), label: p.label as PhoneRow['label'] })) ?? [{ number: '', label: 'mobile' }]);
  const [owner, setOwner] = useState<string | null | undefined>(contact ? contact.owner?.id ?? null : undefined);
  const [tags, setTags] = useState<string[]>(contact?.tags.map((t) => t.id) ?? []);
  const [taxId, setTaxId] = useState(contact?.taxId ?? '');
  const [bDay, setBDay] = useState(contact?.birthday ? String(contact.birthday.day) : '');
  const [bMonth, setBMonth] = useState(contact?.birthday ? String(contact.birthday.month) : '');
  const [bYear, setBYear] = useState(contact?.birthday?.year ? String(contact.birthday.year) : '');
  const [city, setCity] = useState(contact?.address.city ?? '');
  const [state, setState] = useState(contact?.address.state ?? '');
  const [custom, setCustom] = useState<Record<string, unknown>>(contact?.custom ?? {});
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [dups, setDups] = useState<Duplicate[] | null>(null);

  async function submit(e: FormEvent | null, allowDuplicate = false) {
    e?.preventDefault();
    setBusy(true);
    setErr(null);
    const body: Record<string, unknown> = {
      firstName, lastName: lastName || null, jobTitle: jobTitle || null, organizationId: org?.id ?? null, taxId: taxId || null,
      emails: emails.filter((x) => x.email.trim()).map((x, i) => ({ ...x, isPrimary: i === 0 })),
      phones: phones.filter((x) => x.number.trim()).map((x, i) => ({ ...x, isPrimary: i === 0 })),
      tagIds: tags, custom,
      birthday: bDay && bMonth ? { day: Number(bDay), month: Number(bMonth), year: bYear ? Number(bYear) : null } : null,
      address: { ...(contact?.address ?? {}), city, state },
    };
    if (owner !== undefined) body.ownerId = owner;
    if (!contact) {
      body.allowDuplicate = allowDuplicate;
      if (source.trim()) body.touch = { source: source.trim() };
    }
    try {
      const c = contact
        ? await api<Contact>('PATCH', `/api/v1/contacts/${contact.id}`, body)
        : await api<Contact>('POST', '/api/v1/contacts', body);
      onSaved(c);
    } catch (e2) {
      if (e2 instanceof ApiError && e2.type === 'duplicate') {
        setDups((e2.body as { duplicates?: Duplicate[] } | undefined)?.duplicates ?? []);
      } else {
        setErr(e2 instanceof ApiError ? e2 : new ApiError(0, 'error', 'Não foi possível salvar.'));
      }
      setBusy(false);
    }
  }

  if (dups) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="warning">Já existe cadastro com este e-mail ou telefone. Abra o contato existente para não duplicar o histórico.</Alert>
        <ul className="flex flex-col gap-2">
          {dups.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 rounded-[8px] border border-line px-3 py-2.5">
              <div>
                <p className="font-medium">{d.name}</p>
                <p className="text-[13px] text-muted">Mesmo {d.matchedBy.map((m) => (m === 'email' ? 'e-mail' : 'telefone')).join(' e ')}</p>
              </div>
              {d.visible ? <Link href={`/contatos/${d.id}`} className="text-[13px] font-medium text-accent hover:underline">Abrir</Link>
                : <span className="text-[13px] text-muted">De outro responsável</span>}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
          <Button variant="ghost" onClick={() => setDups(null)}>Voltar ao formulário</Button>
          <Button variant="secondary" loading={busy} onClick={() => { setDups(null); void submit(null, true); }}>Criar mesmo assim</Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => submit(e)} noValidate className="flex flex-col gap-4">
      {err ? <Alert tone="error">{err.title}</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome" value={firstName} onChange={(e) => setFirstName(e.target.value)} error={err?.fieldError('firstName')} required autoFocus />
        <Field label="Sobrenome" value={lastName} onChange={(e) => setLastName(e.target.value)} error={err?.fieldError('lastName')} />
        <Field label="Cargo" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
        <EntityPicker kind="organization" label="Organização" value={org} onChange={setOrg} />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-[13px] font-medium">E-mails</legend>
        {emails.map((row, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_130px_40px] items-start gap-2">
            <div>
              <input type="email" aria-label={`E-mail ${i + 1}`} value={row.email} onChange={(e) => setEmails(emails.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))}
                aria-invalid={err?.fieldError(`emails.${i}.email`) ? true : undefined}
                className={`h-11 w-full rounded-[6px] border bg-surface px-3 text-sm ${err?.fieldError(`emails.${i}.email`) ? 'border-bad' : 'border-line-strong'}`} />
              {err?.fieldError(`emails.${i}.email`) ? <p className="mt-1 text-[13px] text-bad">{err.fieldError(`emails.${i}.email`)}</p> : null}
            </div>
            <select aria-label={`Tipo do e-mail ${i + 1}`} value={row.label} onChange={(e) => setEmails(emails.map((x, j) => (j === i ? { ...x, label: e.target.value as EmailRow['label'] } : x)))}
              className="h-11 rounded-[6px] border border-line-strong bg-surface px-2 text-sm">
              <option value="work">Trabalho</option><option value="personal">Pessoal</option><option value="other">Outro</option>
            </select>
            <button type="button" aria-label={`Remover e-mail ${i + 1}`} onClick={() => setEmails(emails.filter((_, j) => j !== i))}
              className="flex size-11 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-bad"><Trash2 size={16} aria-hidden /></button>
          </div>
        ))}
        <button type="button" onClick={() => setEmails([...emails, { email: '', label: 'work' }])} className="inline-flex w-fit items-center gap-1 text-[13px] font-medium text-accent hover:underline">
          <Plus size={14} aria-hidden />Adicionar e-mail
        </button>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-[13px] font-medium">Telefones</legend>
        {phones.map((row, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_130px_40px] items-start gap-2">
            <div>
              <input type="tel" aria-label={`Telefone ${i + 1}`} placeholder="(11) 98765-4321" value={row.number}
                onChange={(e) => setPhones(phones.map((x, j) => (j === i ? { ...x, number: e.target.value } : x)))}
                aria-invalid={err?.fieldError(`phones.${i}.number`) ? true : undefined}
                className={`h-11 w-full rounded-[6px] border bg-surface px-3 text-sm placeholder:text-muted ${err?.fieldError(`phones.${i}.number`) ? 'border-bad' : 'border-line-strong'}`} />
              {err?.fieldError(`phones.${i}.number`) ? <p className="mt-1 text-[13px] text-bad">{err.fieldError(`phones.${i}.number`)}</p> : null}
            </div>
            <select aria-label={`Tipo do telefone ${i + 1}`} value={row.label} onChange={(e) => setPhones(phones.map((x, j) => (j === i ? { ...x, label: e.target.value as PhoneRow['label'] } : x)))}
              className="h-11 rounded-[6px] border border-line-strong bg-surface px-2 text-sm">
              <option value="mobile">Celular</option><option value="whatsapp">WhatsApp</option><option value="work">Trabalho</option>
              <option value="home">Casa</option><option value="other">Outro</option>
            </select>
            <button type="button" aria-label={`Remover telefone ${i + 1}`} onClick={() => setPhones(phones.filter((_, j) => j !== i))}
              className="flex size-11 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-bad"><Trash2 size={16} aria-hidden /></button>
          </div>
        ))}
        <button type="button" onClick={() => setPhones([...phones, { number: '', label: 'mobile' }])} className="inline-flex w-fit items-center gap-1 text-[13px] font-medium text-accent hover:underline">
          <Plus size={14} aria-hidden />Adicionar telefone
        </button>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <MemberSelect value={owner === undefined ? null : owner} noneLabel={contact ? 'Sem responsável' : 'Eu (padrão)'} onChange={(v) => setOwner(v ?? (contact ? null : undefined))} error={err?.fieldError('ownerId')} />
        <Field label="CPF ou documento" value={taxId} onChange={(e) => setTaxId(e.target.value)} error={err?.fieldError('taxId')} />
      </div>
      <fieldset>
        <legend className="mb-1.5 text-[13px] font-medium">Aniversário</legend>
        <div className="grid grid-cols-[90px_minmax(0,1fr)_110px] gap-2">
          <select aria-label="Dia" value={bDay} onChange={(e) => setBDay(e.target.value)} className="h-11 rounded-[6px] border border-line-strong bg-surface px-2 text-sm">
            <option value="">Dia</option>{Array.from({ length: 31 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
          </select>
          <select aria-label="Mês" value={bMonth} onChange={(e) => setBMonth(e.target.value)} className="h-11 rounded-[6px] border border-line-strong bg-surface px-2 text-sm">
            <option value="">Mês</option>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <input aria-label="Ano (opcional)" placeholder="Ano" inputMode="numeric" value={bYear} onChange={(e) => setBYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
            className="h-11 rounded-[6px] border border-line-strong bg-surface px-3 text-sm placeholder:text-muted" />
        </div>
        {err?.fieldError('birthday') ? <p className="mt-1 text-[13px] text-bad">{err.fieldError('birthday')}</p> : null}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_120px]">
        <Field label="Cidade" value={city} onChange={(e) => setCity(e.target.value)} />
        <Field label="UF" value={state} maxLength={2} onChange={(e) => setState(e.target.value.toUpperCase())} />
      </div>
      <TagPicker value={tags} onChange={setTags} />
      <CustomFieldInputs defs={defs ?? []} value={custom} onChange={setCustom} error={err} />
      {!contact ? (
        <Field label="Origem" value={source} onChange={(e) => setSource(e.target.value)} hint="De onde a pessoa veio: indicação, Instagram, feira... Opcional." />
      ) : null}
      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" loading={busy} disabled={!firstName.trim()}>{contact ? 'Salvar' : 'Criar contato'}</Button>
      </div>
    </form>
  );
}

