'use client';
import { useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, Plus } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import type { Ref } from '@/lib/crm';
import { useDirectory } from '@/components/crm/data';
import { TeamSelect } from '@/components/crm/pickers';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Field } from '@/components/ui/field';
import { Dialog } from '@/components/ui/dialog';
import { Confirm } from '@/components/ui/confirm';
import { Empty, LoadError, Loading } from '@/components/ui/states';

type Rule = { id: string; name: string; active: boolean; position: number; sourceFilter: string | null; teamId: string | null; members: Ref[]; nextMembershipId: string | null };

export default function DistributionSettings() {
  const rules = useLoad(() => api<Rule[]>('GET', '/api/v1/assignment-rules'));
  const { data: dir } = useDirectory();
  const [dialog, setDialog] = useState<Rule | 'new' | null>(null);
  const [remove, setRemove] = useState<Rule | null>(null);

  async function toggle(r: Rule) {
    await api('PATCH', `/api/v1/assignment-rules/${r.id}`, { active: !r.active }).catch(() => undefined);
    void rules.reload();
  }

  return (
    <Panel title="Distribuição de leads" description="Lead novo sem responsável passa pelos roteiros, de cima para baixo. O primeiro que combina com a origem escolhe a próxima pessoa da fila, em rodízio."
      actions={<Button onClick={() => setDialog('new')}><Plus size={16} aria-hidden />Novo roteiro</Button>}>
      {rules.error ? <LoadError error={rules.error} retry={rules.reload} /> : !rules.data ? <Loading /> : !rules.data.length ? (
        <Empty title="Nenhum roteiro">Sem roteiro, lead novo fica sem responsável até alguém atribuir.</Empty>
      ) : (
        <ol className="flex flex-col gap-3">
          {rules.data.map((r) => (
            <li key={r.id} className="rounded-[8px] border border-line p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{r.name} {!r.active ? <Badge>Pausado</Badge> : null}</p>
                  <p className="text-[13px] text-muted">
                    {r.sourceFilter ? `Origem: ${r.sourceFilter}` : 'Qualquer origem'}{r.teamId ? ` · Equipe: ${dir?.teams.find((t) => t.id === r.teamId)?.name ?? ''}` : ''}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" onClick={() => toggle(r)}>{r.active ? 'Pausar' : 'Ativar'}</Button>
                  <Button variant="ghost" onClick={() => setDialog(r)}>Editar</Button>
                  <Button variant="ghost" onClick={() => setRemove(r)}>Excluir</Button>
                </div>
              </div>
              <ol className="mt-2 flex flex-wrap gap-1.5">
                {r.members.map((m) => (
                  <li key={m.id} className={`rounded-full border px-2.5 py-1 text-[12px] ${m.id === r.nextMembershipId ? 'border-primary bg-accent-soft font-semibold' : 'border-line'}`}>
                    {m.name}{m.id === r.nextMembershipId ? ' · próximo' : ''}
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ol>
      )}
      <Dialog open={!!dialog} onClose={() => setDialog(null)} title={dialog === 'new' ? 'Novo roteiro' : 'Editar roteiro'}>
        {dialog ? <RuleForm rule={dialog === 'new' ? null : dialog} onDone={() => { setDialog(null); void rules.reload(); }} onCancel={() => setDialog(null)} /> : null}
      </Dialog>
      <Confirm open={!!remove} title={`Excluir o roteiro ${remove?.name}?`} confirmLabel="Excluir"
        onConfirm={async () => { await api('DELETE', `/api/v1/assignment-rules/${remove!.id}`).catch(() => undefined); setRemove(null); void rules.reload(); }} onCancel={() => setRemove(null)}>
        Leads já distribuídos continuam com seus responsáveis.
      </Confirm>
    </Panel>
  );
}

function RuleForm({ rule, onDone, onCancel }: { rule: Rule | null; onDone: () => void; onCancel: () => void }) {
  const { data: dir } = useDirectory();
  const [name, setName] = useState(rule?.name ?? '');
  const [source, setSource] = useState(rule?.sourceFilter ?? '');
  const [team, setTeam] = useState<string | null>(rule?.teamId ?? null);
  const [members, setMembers] = useState<string[]>(rule?.members.map((m) => m.id) ?? []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const nameOf = (id: string) => dir?.members.find((m) => m.id === id)?.name ?? '';
  const move = (i: number, d: number) => { const n = [...members]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x!); setMembers(n); };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const body = { name, sourceFilter: source || null, teamId: team, memberIds: members };
    try {
      if (rule) await api('PATCH', `/api/v1/assignment-rules/${rule.id}`, body); else await api('POST', '/api/v1/assignment-rules', body);
      onDone();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? (e2.errors[0]?.message ?? e2.title) : 'Não foi possível salvar.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {err ? <Alert tone="error">{err}</Alert> : null}
      <Field label="Nome" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Leads do site" required />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Só para a origem" value={source} onChange={(e) => setSource(e.target.value)} hint="Vazio vale para qualquer origem." />
        <TeamSelect label="Equipe do lead" value={team} onChange={setTeam} />
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[13px] font-medium">Fila do rodízio</legend>
        <ol className="flex flex-col gap-1">
          {members.map((id, i) => (
            <li key={id} className="flex items-center gap-2 rounded-[6px] border border-line px-2 py-1.5 text-sm">
              <span className="w-5 text-right text-muted">{i + 1}.</span><span className="flex-1">{nameOf(id)}</span>
              <button type="button" aria-label="Subir" disabled={i === 0} onClick={() => move(i, -1)} className="flex size-8 items-center justify-center rounded-[6px] disabled:opacity-30"><ArrowUp size={14} aria-hidden /></button>
              <button type="button" aria-label="Descer" disabled={i === members.length - 1} onClick={() => move(i, 1)} className="flex size-8 items-center justify-center rounded-[6px] disabled:opacity-30"><ArrowDown size={14} aria-hidden /></button>
              <button type="button" onClick={() => setMembers(members.filter((m) => m !== id))} className="text-[13px] font-medium text-bad">Tirar</button>
            </li>
          ))}
        </ol>
        <select aria-label="Adicionar pessoa à fila" value="" onChange={(e) => e.target.value && setMembers([...members, e.target.value])} className="h-10 rounded-[6px] border border-line-strong bg-surface px-2 text-sm">
          <option value="">Adicionar pessoa…</option>
          {(dir?.members ?? []).filter((m) => !members.includes(m.id)).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        {rule ? <p className="text-[13px] text-muted">Mudar a fila reinicia o rodízio do começo.</p> : null}
      </fieldset>
      <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button><Button type="submit" loading={busy} disabled={!name.trim() || !members.length}>Salvar</Button></div>
    </form>
  );
}
