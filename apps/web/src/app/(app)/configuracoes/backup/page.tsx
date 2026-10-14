'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { Download, HardDriveDownload, RotateCcw, Trash2 } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { dateTime } from '@/lib/admin-types';
import { fileSize } from '@/lib/crm';
import { Panel } from '@/components/ui/panel';
import { Field } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Confirm } from '@/components/ui/confirm';
import { Dialog } from '@/components/ui/dialog';
import { LoadError, Loading } from '@/components/ui/states';

type Backup = { name: string; createdAt: string; expiresAt: string; includesFiles: boolean; sizeBytes: number };
type Job = {
  id: string; type: 'backup_tenant' | 'restore_tenant_backup'; file?: string;
  requestedBy: string; requestedAt: string; status: 'pending' | 'running' | 'done' | 'failed';
  log: string[]; error?: string;
};
type Overview = { available: boolean; retentionDays: number; agentAlive: boolean; items: Backup[]; jobs: Job[] };

const JOB: Record<Job['type'], string> = { backup_tenant: 'Cópia da empresa', restore_tenant_backup: 'Restauração da empresa' };
const STATUS: Record<Job['status'], { label: string; tone: 'info' | 'ok' | 'bad' | 'neutral' }> = {
  pending: { label: 'Na fila', tone: 'neutral' }, running: { label: 'Em andamento', tone: 'info' },
  done: { label: 'Concluído', tone: 'ok' }, failed: { label: 'Falhou', tone: 'bad' },
};
const day = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

export default function TenantBackupPage() {
  const { data, error, loading, reload } = useLoad(() => api<Overview>('GET', '/api/v1/backups'));
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<Backup | null>(null);
  const [removing, setRemoving] = useState<Backup | null>(null);
  const active = data?.jobs.some((j) => j.status === 'pending' || j.status === 'running') ?? false;

  // Enquanto há trabalho na fila, atualiza a cada 3 s.
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void reload(), 3000);
    return () => clearInterval(t);
  }, [active, reload]);

  if (loading && !data) return <Loading />;
  if (error) return <LoadError error={error} retry={reload} />;
  const d = data!;

  async function run(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    setErr(null);
    setMsg(null);
    try {
      await fn();
      setMsg(ok);
      await reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.title : 'Não foi possível concluir.');
    } finally {
      setBusy(null);
    }
  }

  if (!d.available) {
    return (
      <Panel title="Cópias de segurança">
        <Alert tone="info">As cópias de segurança ainda não estão ligadas neste servidor. Fale com o suporte da plataforma.</Alert>
      </Panel>
    );
  }

  const running = d.jobs.find((j) => j.status === 'pending' || j.status === 'running');
  const when = (b: Backup) => dateTime.format(new Date(b.createdAt));

  return (
    <div className="flex flex-col gap-5">
      {msg ? <Alert tone="success">{msg}</Alert> : null}
      {err ? <Alert tone="error">{err}</Alert> : null}

      <Panel title="Cópias de segurança da empresa"
        description={`Dados e arquivos só desta empresa. Cada cópia fica guardada por ${d.retentionDays} dias e depois é apagada sozinha.`}
        actions={
          <Button loading={busy === 'now'} disabled={!!running}
            onClick={() => void run('now', () => api('POST', '/api/v1/backups'), 'Cópia pedida. Ela aparece na lista quando terminar.')}>
            <HardDriveDownload size={16} aria-hidden />Fazer cópia agora
          </Button>
        }>
        <div className="flex flex-col gap-2 text-[13px]">
          {d.agentAlive ? null : <Alert tone="error">O serviço de cópias não está respondendo agora. Os pedidos ficam na fila até ele voltar.</Alert>}
          <p className="text-muted">
            Para guardar por mais tempo, baixe a cópia e salve no computador ou num drive. O arquivo tem os dados dos seus clientes: guarde em local seguro.
          </p>
        </div>
      </Panel>

      {running ? (
        <Panel title={`${JOB[running.type]}: ${STATUS[running.status].label.toLowerCase()}`} description="Pode levar alguns minutos; a página se atualiza sozinha.">
          <ol aria-live="polite" className="flex max-h-48 flex-col gap-1 overflow-y-auto font-mono text-[12px] text-muted">
            {running.log.length === 0 ? <li>Aguardando o serviço de cópias…</li> : running.log.map((l, i) => <li key={i}>{l.replace(/^\S+ /, '')}</li>)}
          </ol>
        </Panel>
      ) : null}

      <Panel title="Cópias disponíveis">
        {d.items.length === 0 ? <p className="text-[13px] text-muted">Nenhuma cópia ainda. Clique em &ldquo;Fazer cópia agora&rdquo;.</p> : (
          <div className="-mx-5 overflow-x-auto px-5" tabIndex={0} role="region" aria-label="Cópias disponíveis">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[13px] text-muted">
                  <th className="py-2 pr-3 font-medium">Data</th><th className="py-2 pr-3 font-medium">Tamanho</th>
                  <th className="py-2 pr-3 font-medium">Apagada em</th><th className="py-2 font-medium"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {d.items.map((b) => (
                  <tr key={b.name} className="border-b border-line last:border-0">
                    <td className="py-2 pr-3 whitespace-nowrap">{when(b)}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{fileSize(b.sizeBytes)}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{day.format(new Date(b.expiresAt))}</td>
                    <td className="py-2">
                      <div className="flex justify-end gap-1">
                        <a href={`/api/v1/backups/${encodeURIComponent(b.name)}/download`} download
                          className="inline-flex h-10 items-center gap-2 rounded-[6px] px-3 text-sm font-medium text-muted hover:bg-surface-2 hover:text-ink">
                          <Download size={16} aria-hidden />Baixar<span className="sr-only"> a cópia de {when(b)}</span>
                        </a>
                        <Button variant="secondary" disabled={!!running} onClick={() => setRestoring(b)}>
                          <RotateCcw size={16} aria-hidden />Restaurar<span className="sr-only"> a cópia de {when(b)}</span>
                        </Button>
                        <Button variant="ghost" aria-label={`Excluir a cópia de ${when(b)}`} onClick={() => setRemoving(b)}><Trash2 size={16} aria-hidden /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {d.jobs.length ? (
        <Panel title="Últimos trabalhos">
          <ul className="flex flex-col">
            {d.jobs.map((j) => (
              <li key={j.id} className="border-t border-line py-2.5 first:border-t-0 first:pt-0">
                <p className="font-medium">{JOB[j.type]} <Badge tone={STATUS[j.status].tone}>{STATUS[j.status].label}</Badge></p>
                <p className="text-[13px] text-muted">{dateTime.format(new Date(j.requestedAt))} · {j.requestedBy}</p>
                {j.error ? <p className="text-[13px] text-bad">{j.error}</p> : null}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {restoring ? <RestoreDialog backup={restoring} onClose={() => setRestoring(null)} onDone={() => { setRestoring(null); setMsg('Restauração pedida. Acompanhe abaixo.'); void reload(); }} /> : null}
      <Confirm open={!!removing} title="Excluir esta cópia?" confirmLabel="Excluir" loading={busy === 'del'}
        onConfirm={() => { const b = removing!; setRemoving(null); void run('del', () => api('DELETE', `/api/v1/backups/${encodeURIComponent(b.name)}`), 'Cópia excluída.'); }}
        onCancel={() => setRemoving(null)}>
        A cópia de {removing ? when(removing) : ''} sai do servidor. Se você baixou o arquivo, ele continua com você.
      </Confirm>
    </div>
  );
}

function RestoreDialog({ backup, onClose, onDone }: { backup: Backup; onClose: () => void; onDone: () => void }) {
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api('POST', `/api/v1/backups/${encodeURIComponent(backup.name)}/restore`, { confirm });
      onDone();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2 : new ApiError(0, 'error', 'Não foi possível pedir a restauração.'));
      setBusy(false);
    }
  }

  return (
    <Dialog open title="Restaurar cópia" description={`Cópia de ${dateTime.format(new Date(backup.createdAt))}`} onClose={onClose} width={560}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {err && !err.fieldError('confirm') ? <Alert tone="error">{err.title}</Alert> : null}
        <p className="text-sm">
          Contatos, negócios, leads, mensagens, configurações e arquivos da empresa voltam ao momento da cópia. O que foi feito depois dela some.
          Os usuários continuam com as senhas de hoje.
        </p>
        <Alert tone="info">Antes de restaurar, o CRM faz sozinho uma cópia do estado atual, para desfazer se for preciso.</Alert>
        <Field label="Digite RESTAURAR para confirmar" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" error={err?.fieldError('confirm')} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="danger" loading={busy} disabled={confirm !== 'RESTAURAR'}>
            <RotateCcw size={16} aria-hidden />Restaurar a empresa
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
