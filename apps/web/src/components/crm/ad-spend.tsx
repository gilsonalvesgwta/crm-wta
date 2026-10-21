'use client';
import { useState, type FormEvent } from 'react';
import { Link2, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { money, moneyInput, parseMoney } from '@/lib/crm';
import { useSession } from '@/components/shell/session';
import { Panel } from '@/components/ui/panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import { Confirm } from '@/components/ui/confirm';
import { LoadError, Loading } from '@/components/ui/states';

export type Platform = 'meta' | 'google' | 'tiktok' | 'other';
export const PLATFORM_NAME: Record<string, string> = { meta: 'Meta Ads', google: 'Google Ads', tiktok: 'TikTok Ads', other: 'Outro' };

type Spend = {
  id: string; platform: Platform; description: string | null; firstDay: string; lastDay: string; amountCents: number;
  account: { id: string; name: string } | null; createdBy: { id: string; name: string } | null;
};
type AdAccount = {
  id: string; platform: 'meta'; externalId: string; name: string; currency: string | null; status: 'connected' | 'error';
  lastError: string | null; lastSyncAt: string | null;
};

const dDay = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
export const fmtDay = (d: string) => dDay.format(new Date(`${d}T00:00:00Z`));
const fmtWhen = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

function SpendDialog({ spend, onClose, onSaved }: { spend: Spend | null; onClose: () => void; onSaved: () => void }) {
  const today = new Intl.DateTimeFormat('en-CA').format(new Date());
  const [platform, setPlatform] = useState<Platform>(spend?.platform ?? 'meta');
  const [description, setDescription] = useState(spend?.description ?? '');
  const [firstDay, setFirstDay] = useState(spend?.firstDay ?? today);
  const [lastDay, setLastDay] = useState(spend?.lastDay ?? today);
  const [amount, setAmount] = useState(spend ? moneyInput(spend.amountCents) : '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const cents = parseMoney(amount);
    if (cents === null) {
      setErr(new ApiError(422, 'validation', 'Confira o valor.', [{ field: 'amountCents', message: 'Informe o valor gasto, por exemplo 1.500,00.' }]));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const body = { platform, description: description.trim() || null, firstDay, lastDay, amountCents: cents };
      await api(spend ? 'PATCH' : 'POST', spend ? `/api/v1/ads/spend/${spend.id}` : '/api/v1/ads/spend', body);
      onSaved();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2 : new ApiError(0, 'error', 'Não foi possível salvar.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open title={spend ? 'Editar investimento' : 'Lançar investimento'} onClose={onClose} width={520}
      description="Quanto foi gasto em anúncios num período. O valor é dividido por igual entre os dias para os KPIs.">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {err && !err.fieldError('amountCents') && !err.fieldError('lastDay') ? <Alert tone="error">{err.title}</Alert> : null}
        <Select label="Plataforma" value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>
          {Object.entries(PLATFORM_NAME).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <Field label="Descrição (opcional)" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} placeholder="Ex.: Campanha consórcio imóvel" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Primeiro dia" type="date" value={firstDay} onChange={(e) => setFirstDay(e.target.value)} />
          <Field label="Último dia" type="date" value={lastDay} min={firstDay} onChange={(e) => setLastDay(e.target.value)} error={err?.fieldError('lastDay')} />
        </div>
        <Field label="Valor gasto (R$)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" error={err?.fieldError('amountCents')} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={busy}>{spend ? 'Salvar' : 'Lançar'}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function MetaAdsDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [accountId, setAccountId] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api('POST', '/api/v1/ads/accounts/meta', { accountId, token });
      onSaved();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2 : new ApiError(0, 'error', 'Não foi possível ligar a conta.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open title="Importar gasto da Meta Ads" onClose={onClose} width={620}
      description="O CRM busca o gasto de cada dia na conta de anúncios a cada 6 horas (na primeira vez, os últimos 90 dias).">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <ol className="flex list-decimal flex-col gap-1.5 rounded-[8px] border border-line bg-surface-2 p-3 pl-7 text-[13px]">
          <li>No <strong>Gerenciador de Anúncios</strong>, copie o número da conta (aparece como <code>act_…</code> na barra de endereço ou no seletor de contas).</li>
          <li>No <strong>Business Manager</strong> › Configurações do negócio › Usuários › <strong>Usuários do sistema</strong>, crie (ou escolha) um usuário do sistema e, em <em>Atribuir ativos</em>, dê acesso à conta de anúncios.</li>
          <li>Clique em <strong>Gerar novo token</strong>, escolha o app da empresa, marque a permissão <strong>ads_read</strong> e deixe o token <strong>sem validade</strong> (nunca expira).</li>
          <li>Cole o número da conta e o token abaixo. O token fica cifrado e não aparece de novo.</li>
        </ol>
        {err && !err.fieldError('accountId') && !err.fieldError('token') ? <Alert tone="error">{err.title}</Alert> : null}
        <Field label="Conta de anúncios" value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="act_1234567890" autoComplete="off" error={err?.fieldError('accountId')} />
        <Field label="Token de acesso (ads_read)" value={token} onChange={(e) => setToken(e.target.value)} type="password" autoComplete="off" error={err?.fieldError('token')} />
        <p className="text-[12px] text-muted">Google Ads ainda não tem importação automática (a API do Google exige um token de desenvolvedor aprovado). Lance o gasto do Google à mão.</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={busy} disabled={!accountId.trim() || !token.trim()}>Ligar e importar</Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Investimento em anúncios do período: lançamentos e contas da Meta ligadas. */
export function AdSpendPanel({ from, to, onChange }: { from: string; to: string; onChange: () => void }) {
  const { can } = useSession();
  const canEdit = can('reports:export');
  const list = useLoad(() => api<Spend[]>('GET', `/api/v1/ads/spend?from=${from}&to=${to}`), [from, to]);
  const accounts = useLoad(() => api<AdAccount[]>('GET', '/api/v1/ads/accounts'), []);
  const [dialog, setDialog] = useState<{ spend: Spend | null } | null>(null);
  const [metaOpen, setMetaOpen] = useState(false);
  const [del, setDel] = useState<Spend | null>(null);
  const [off, setOff] = useState<AdAccount | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [showImported, setShowImported] = useState(false);

  const changed = () => { void list.reload(); void accounts.reload(); onChange(); };
  const manual = (list.data ?? []).filter((s) => !s.account);
  const imported = (list.data ?? []).filter((s) => s.account);
  const importedTotal = imported.reduce((t, s) => t + s.amountCents, 0);

  async function sync(a: AdAccount) {
    setSyncing(a.id);
    try { await api('POST', `/api/v1/ads/accounts/${a.id}/sync`); } catch { /* o estado da conta mostra o erro */ }
    setSyncing(null);
    changed();
  }

  return (
    <Panel title="Investimento em anúncios" description={`Lançamentos que tocam o período de ${fmtDay(from)} a ${fmtDay(to)}.`}
      actions={canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => setMetaOpen(true)}><Link2 size={16} aria-hidden />Importar da Meta</Button>
          <Button type="button" onClick={() => setDialog({ spend: null })}><Plus size={16} aria-hidden />Lançar investimento</Button>
        </div>
      ) : undefined}>
      <div className="flex flex-col gap-4">
        {(accounts.data ?? []).length ? (
          <ul className="flex flex-col gap-2" aria-label="Contas da Meta Ads ligadas">
            {accounts.data!.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[8px] border border-line p-3 text-sm">
                <span className="font-medium">{a.name}</span>
                <span className="text-[12px] text-muted">act_{a.externalId}{a.currency && a.currency !== 'BRL' ? ` · moeda ${a.currency}` : ''}</span>
                {a.status === 'connected' ? <Badge tone="ok">Importando</Badge> : <Badge tone="bad">Com erro</Badge>}
                <span className="text-[12px] text-muted">{a.lastSyncAt ? `Última importação: ${fmtWhen.format(new Date(a.lastSyncAt))}` : 'Ainda não importou'}</span>
                {canEdit ? (
                  <span className="ml-auto flex gap-1">
                    <Button type="button" variant="ghost" loading={syncing === a.id} onClick={() => void sync(a)}><RefreshCw size={15} aria-hidden />Importar agora</Button>
                    <Button type="button" variant="ghost" onClick={() => setOff(a)}>Desligar</Button>
                  </span>
                ) : null}
                {a.lastError ? <p className="w-full text-[12px] text-bad">{a.lastError}</p> : null}
              </li>
            ))}
          </ul>
        ) : null}

        {list.error ? <LoadError error={list.error} retry={list.reload} /> : !list.data ? <Loading /> : !list.data.length ? (
          <p className="text-[13px] text-muted">Nenhum investimento no período. {canEdit ? 'Lance o gasto de cada plataforma (valor e período) ou importe da Meta.' : ''}</p>
        ) : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Lançamentos de investimento">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr className="border-b border-line text-left text-[12px] text-muted">
                <th scope="col" className="py-1.5 font-medium">Plataforma</th><th scope="col" className="py-1.5 font-medium">Período</th>
                <th scope="col" className="py-1.5 font-medium">Origem</th><th scope="col" className="py-1.5 text-right font-medium">Valor</th>
                <th scope="col" className="py-1.5"><span className="sr-only">Ações</span></th>
              </tr></thead>
              <tbody>
                {manual.map((s) => (
                  <tr key={s.id} className="border-b border-line last:border-0">
                    <td className="py-2">{PLATFORM_NAME[s.platform]}{s.description ? <span className="text-muted"> · {s.description}</span> : null}</td>
                    <td className="py-2 tabular-nums">{s.firstDay === s.lastDay ? fmtDay(s.firstDay) : `${fmtDay(s.firstDay)} a ${fmtDay(s.lastDay)}`}</td>
                    <td className="py-2 text-muted">Lançado{s.createdBy ? ` por ${s.createdBy.name}` : ''}</td>
                    <td className="py-2 text-right tabular-nums">{money(s.amountCents)}</td>
                    <td className="py-2 text-right">
                      {canEdit ? (
                        <span className="inline-flex gap-1">
                          <button type="button" onClick={() => setDialog({ spend: s })} aria-label={`Editar ${PLATFORM_NAME[s.platform]} de ${fmtDay(s.firstDay)}`} className="rounded-[6px] p-1.5 hover:bg-surface-2"><Pencil size={15} aria-hidden /></button>
                          <button type="button" onClick={() => setDel(s)} aria-label={`Apagar ${PLATFORM_NAME[s.platform]} de ${fmtDay(s.firstDay)}`} className="rounded-[6px] p-1.5 hover:bg-surface-2"><Trash2 size={15} aria-hidden /></button>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {imported.length ? (
                  <tr className="border-b border-line last:border-0">
                    <td className="py-2">Meta Ads</td>
                    <td className="py-2">{imported.length} {imported.length === 1 ? 'dia' : 'dias'} com gasto</td>
                    <td className="py-2 text-muted">
                      Importado <button type="button" onClick={() => setShowImported((v) => !v)} aria-expanded={showImported} className="text-accent underline">{showImported ? 'esconder dias' : 'ver dias'}</button>
                    </td>
                    <td className="py-2 text-right tabular-nums">{money(importedTotal)}</td>
                    <td />
                  </tr>
                ) : null}
                {showImported ? imported.map((s) => (
                  <tr key={s.id} className="border-b border-line text-[13px] text-muted last:border-0">
                    <td className="py-1.5 pl-4">{s.account?.name}</td><td className="py-1.5 tabular-nums">{fmtDay(s.firstDay)}</td><td />
                    <td className="py-1.5 text-right tabular-nums">{money(s.amountCents)}</td><td />
                  </tr>
                )) : null}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {dialog ? <SpendDialog spend={dialog.spend} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); changed(); }} /> : null}
      {metaOpen ? <MetaAdsDialog onClose={() => setMetaOpen(false)} onSaved={() => { setMetaOpen(false); changed(); }} /> : null}
      <Confirm open={!!del} title="Apagar lançamento?" confirmLabel="Apagar" onCancel={() => setDel(null)}
        onConfirm={async () => { if (del) await api('DELETE', `/api/v1/ads/spend/${del.id}`).catch(() => undefined); setDel(null); changed(); }}>
        {del ? `${PLATFORM_NAME[del.platform]}: ${money(del.amountCents)}. Os KPIs deixam de contar este valor.` : ''}
      </Confirm>
      <Confirm open={!!off} title="Desligar a conta da Meta Ads?" confirmLabel="Desligar" onCancel={() => setOff(null)}
        onConfirm={async () => { if (off) await api('DELETE', `/api/v1/ads/accounts/${off.id}`).catch(() => undefined); setOff(null); changed(); }}>
        O gasto importado desta conta sai dos KPIs. Os lançamentos feitos à mão continuam.
      </Confirm>
    </Panel>
  );
}
