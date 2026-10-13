'use client';
import { useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api';
import { phone, type Organization } from '@/lib/crm';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { CustomFieldInputs } from './custom-fields';
import { useFields } from './data';
import { MemberSelect, TagPicker } from './pickers';

export function OrganizationDialog({ open, org, onClose, onSaved }: {
  open: boolean; org?: Organization | null; onClose: () => void; onSaved: (o: Organization) => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={org ? 'Editar organização' : 'Nova organização'} width={640}>
      <OrgForm org={org ?? null} onSaved={onSaved} onCancel={onClose} />
    </Dialog>
  );
}

function OrgForm({ org, onSaved, onCancel }: { org: Organization | null; onSaved: (o: Organization) => void; onCancel: () => void }) {
  const { data: defs } = useFields('organization');
  const [v, setV] = useState({
    name: org?.name ?? '', legalName: org?.legalName ?? '', taxId: org?.taxId ?? '', website: org?.website ?? '', email: org?.email ?? '',
    phone: phone(org?.phone), industry: org?.industry ?? '', city: org?.address.city ?? '', state: org?.address.state ?? '',
  });
  const [owner, setOwner] = useState<string | null | undefined>(org ? org.owner?.id ?? null : undefined);
  const [tags, setTags] = useState<string[]>(org?.tags.map((t) => t.id) ?? []);
  const [custom, setCustom] = useState<Record<string, unknown>>(org?.custom ?? {});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const body: Record<string, unknown> = {
      name: v.name, legalName: v.legalName || null, taxId: v.taxId || null, website: v.website || null, email: v.email || null,
      phone: v.phone || null, industry: v.industry || null, address: { ...(org?.address ?? {}), city: v.city, state: v.state }, tagIds: tags, custom,
    };
    if (owner !== undefined) body.ownerId = owner;
    try {
      onSaved(org ? await api<Organization>('PATCH', `/api/v1/organizations/${org.id}`, body) : await api<Organization>('POST', '/api/v1/organizations', body));
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2 : new ApiError(0, 'error', 'Não foi possível salvar.'));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {err ? <Alert tone="error">{err.title}</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome" value={v.name} onChange={set('name')} error={err?.fieldError('name')} required autoFocus />
        <Field label="Razão social" value={v.legalName} onChange={set('legalName')} />
        <Field label="CNPJ" value={v.taxId} onChange={set('taxId')} error={err?.fieldError('taxId')} />
        <Field label="Segmento" value={v.industry} onChange={set('industry')} />
        <Field label="Site" value={v.website} onChange={set('website')} error={err?.fieldError('website')} placeholder="empresa.com.br" />
        <Field label="E-mail" type="email" value={v.email} onChange={set('email')} error={err?.fieldError('email')} />
        <Field label="Telefone" type="tel" value={v.phone} onChange={set('phone')} error={err?.fieldError('phone')} />
        <MemberSelect value={owner === undefined ? null : owner} noneLabel={org ? 'Sem responsável' : 'Eu (padrão)'} onChange={(x) => setOwner(x ?? (org ? null : undefined))} error={err?.fieldError('ownerId')} />
        <Field label="Cidade" value={v.city} onChange={set('city')} />
        <Field label="UF" value={v.state} maxLength={2} onChange={(e) => setV({ ...v, state: e.target.value.toUpperCase() })} />
      </div>
      <TagPicker value={tags} onChange={setTags} />
      <CustomFieldInputs defs={defs ?? []} value={custom} onChange={setCustom} error={err} />
      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" loading={busy} disabled={!v.name.trim()}>{org ? 'Salvar' : 'Criar organização'}</Button>
      </div>
    </form>
  );
}
