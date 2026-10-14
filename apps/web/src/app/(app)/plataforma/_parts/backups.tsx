'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Download, HardDriveDownload, RotateCcw, Trash2, Upload } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { dateTime } from '@/lib/admin-types';
import { fileSize } from '@/lib/crm';
import { Panel } from '@/components/ui/panel';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Confirm } from '@/components/ui/confirm';
import { Dialog } from '@/components/ui/dialog';
import { LoadError, Loading } from '@/components/ui/states';

type Tenant = { id: string; name: string; slug: string; status: string };
type Backup = {
  name: string; createdAt: string; kind: 'diaria' | 'manual' | 'antes-de-restaurar' | 'enviada' | 'antiga';
  format: 'tar' | 'dump'; includesFiles: boolean; sizeBytes: number; migrations: string[]; tenants: Tenant[]; pending?: boolean;
};
type Job = {
  id: string; type: 'backup' | 'restore_full' | 'restore_tenant' | 'inspect'; file?: string; tenantId?: string;
  requestedBy: string; requestedAt: string; status: 'pending' | 'running' | 'done' | 'failed';
  finishedAt?: string; log: string[]; error?: string; result?: string;
};
type Overview = {
  available: boolean;
  agent: { alive: boolean; at: string | null; nextDaily: string | null; busy: string | null } | null;
  items: Backup[]; jobs: Job[];
};

const KIND: Record<Backup['kind'], string> = {
  diaria: 'Automática', manual: 'Manual', 'antes-de-restaurar': 'Antes de restaurar', enviada: 'Enviada', antiga: 'Automática (antiga)',
};
const JOB: Record<Job['type'], string> = {
  backup: 'Cópia agora', restore_full: 'Restaurar o banco inteiro', restore_tenant: 'Restaurar uma empresa', inspect: 'Conferir cópia enviada',
};
const STATUS: Record<Job['status'], { label: string; tone: 'info' | 'ok' | 'bad' | 'neutral' }> = {
  pending: { label: 'Na fila', tone: 'neutral' }, running: { label: 'Em andamento', tone: 'info' },
  done: { label: 'Concluído', tone: 'ok' }, failed: { label: 'Falhou', tone: 'bad' },
};

export function BackupsTab() {
  const { data, error, loading, reload } = useLoad(() => api<Overview>('GET', '/api/v1/platform/backups'));
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<Backup | null>(null);
  const [removing, setRemoving] = useState<Backup | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
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

  function upload(file: File) {
    setErr(null);
    setMsg(null);
    const fd = new FormData();
    fd.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/v1/platform/backups/upload');
    xhr.setRequestHeader('x-crm-request', '1');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      setProgress(null);
      if (xhr.status >= 200 && xhr.status < 300) {
        setMsg('Cópia enviada. O serviço de cópias confere o arquivo e ela aparece na lista em seguida.');
        void reload();
      } else {
        let title = 'Não foi possível enviar a cópia.';
        try { title = (JSON.parse(xhr.responseText) as { title?: string; errors?: { message: string }[] }).errors?.[0]?.message ?? JSON.parse(xhr.responseText).title ?? title; } catch { /* resposta sem JSON */ }
        setErr(title);
      }
    };
    xhr.onerror = () => { setProgress(null); setErr('Sem conexão com o servidor.'); };
    xhr.send(fd);
  }

  if (!d.available) {
    return (
      <Panel title="Cópias de segurança">
        <Alert tone="info">
          As cópias ainda não estão ligadas à tela. Atualize a stack no Portainer com o arquivo novo (ele liga a pasta das cópias à API) e volte aqui.
        </Alert>
      </Panel>
    );
  }

  const running = d.jobs.find((j) => j.status === 'pending' || j.status === 'running');

  return (
    <div className="flex flex-col gap-5">
      {msg ? <Alert tone="success">{msg}</Alert> : null}
      {err ? <Alert tone="error">{err}</Alert> : null}

      <Panel title="Cópias de segurança" description="Banco de dados e arquivos de todas as empresas. Uma cópia automática por dia; as últimas 7 diárias, 4 semanais e 6 mensais ficam guardadas."
        actions={<div className="flex flex-wrap gap-2">
          <Button variant="secondary" loading={progress !== null} onClick={() => input.current?.click()} disabled={progress !== null}>
            <Upload size={16} aria-hidden />{progress !== null ? `Enviando ${progress}%` : 'Enviar cópia guardada'}
          </Button>
          <Button loading={busy === 'now'} disabled={!!running}
            onClick={() => void run('now', () => api('POST', '/api/v1/platform/backups'), 'Cópia pedida. Ela aparece na lista quando terminar.')}>
            <HardDriveDownload size={16} aria-hidden />Fazer cópia agora
          </Button>
        </div>}>
        <input ref={input} type="file" accept=".tar,.dump" className="sr-only" tabIndex={-1} aria-label="Arquivo da cópia para enviar"
          onChange={(e) => { const file = e.target.files?.[0]; if (file) upload(file); e.target.value = ''; }} />
        <div className="flex flex-col gap-1 text-[13px]">
          {d.agent?.alive
            ? <p><Badge tone="ok">Serviço de cópias funcionando</Badge>{d.agent.nextDaily ? <span className="ml-2 text-muted">Próxima cópia automática: {dateTime.format(new Date(d.agent.nextDaily))}</span> : null}</p>
            : <Alert tone="error">O serviço de cópias (serviço &ldquo;backup&rdquo; da stack) não está respondendo. Confira no Portainer se ele está em 1/1.</Alert>}
          <p className="text-muted">
            Para guardar fora da VPS, baixe uma cópia e salve no computador ou num drive. Para restaurar uma cópia guardada fora, use &ldquo;Enviar cópia guardada&rdquo;.
            O arquivo baixado tem os dados de todas as empresas: guarde em local seguro.
          </p>
        </div>
      </Panel>

      {running ? <JobPanel job={running} /> : null}

      <Panel title="Cópias disponíveis">
        {d.items.length === 0 ? <p className="text-[13px] text-muted">Nenhuma cópia ainda. A primeira automática sai no horário marcado, ou clique em &ldquo;Fazer cópia agora&rdquo;.</p> : (
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[13px] text-muted">
                  <th className="py-2 pr-3 font-medium">Data</th><th className="py-2 pr-3 font-medium">Tipo</th>
                  <th className="py-2 pr-3 font-medium">Empresas</th><th className="py-2 pr-3 font-medium">Tamanho</th>
                  <th className="py-2 pr-3 font-medium">Arquivos</th><th className="py-2 font-medium"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {d.items.map((b) => (
                  <tr key={b.name} className="border-b border-line last:border-0">
                    <td className="py-2 pr-3 whitespace-nowrap">{dateTime.format(new Date(b.createdAt))}</td>
                    <td className="py-2 pr-3">{b.pending ? <Badge tone="info">Conferindo</Badge> : KIND[b.kind]}</td>
                    <td className="py-2 pr-3" title={b.tenants.map((t) => t.name).join(', ')}>{b.pending ? '—' : b.tenants.length}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{fileSize(b.sizeBytes)}</td>
                    <td className="py-2 pr-3">{b.includesFiles ? 'Incluídos' : 'Só o banco'}</td>
                    <td className="py-2">
                      <div className="flex justify-end gap-1">
                        <a href={`/api/v1/platform/backups/${encodeURIComponent(b.name)}/download`} download
                          className="inline-flex h-10 items-center gap-2 rounded-[6px] px-3 text-sm font-medium text-muted hover:bg-surface-2 hover:text-ink">
                          <Download size={16} aria-hidden />Baixar<span className="sr-only"> a cópia de {dateTime.format(new Date(b.createdAt))}</span>
                        </a>
                        <Button variant="secondary" disabled={!!running || b.pending} onClick={() => setRestoring(b)}>
                          <RotateCcw size={16} aria-hidden />Restaurar<span className="sr-only"> a cópia de {dateTime.format(new Date(b.createdAt))}</span>
                        </Button>
                        <Button variant="ghost" aria-label={`Excluir a cópia de ${dateTime.format(new Date(b.createdAt))}`} onClick={() => setRemoving(b)}><Trash2 size={16} aria-hidden /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Últimos trabalhos">
        {d.jobs.length === 0 ? <p className="text-[13px] text-muted">Nenhum ainda.</p> : (
          <ul className="flex flex-col">
            {d.jobs.map((j) => (
              <li key={j.id} className="flex flex-wrap items-start justify-between gap-3 border-t border-line py-2.5 first:border-t-0 first:pt-0">
                <div className="min-w-0">
                  <p className="font-medium">{JOB[j.type]} <Badge tone={STATUS[j.status].tone}>{STATUS[j.status].label}</Badge></p>
                  <p className="text-[13px] text-muted">{dateTime.format(new Date(j.requestedAt))} · {j.requestedBy}{j.file ? ` · ${j.file}` : ''}</p>
                  {j.error ? <p className="text-[13px] text-bad">{j.error}</p> : j.status === 'done' && j.result ? <p className="text-[13px] text-muted">{j.result}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {restoring ? <RestoreDialog backup={restoring} onClose={() => setRestoring(null)} onDone={(m) => { setRestoring(null); setMsg(m); void reload(); }} /> : null}
      <Confirm open={!!removing} title="Excluir esta cópia?" confirmLabel="Excluir" loading={busy === 'del'}
        onConfirm={() => { const b = removing!; setRemoving(null); void run('del', () => api('DELETE', `/api/v1/platform/backups/${encodeURIComponent(b.name)}`), 'Cópia excluída.'); }}
        onCancel={() => setRemoving(null)}>
        A cópia de {removing ? dateTime.format(new Date(removing.createdAt)) : ''} sai da VPS. Se você baixou o arquivo, ele continua com você.
      </Confirm>
    </div>
  );
}

function JobPanel({ job }: { job: Job }) {
  return (
    <Panel title={`${JOB[job.type]}: ${STATUS[job.status].label.toLowerCase()}`} description={`Pedido por ${job.requestedBy}. Pode levar alguns minutos; a página se atualiza sozinha.`}>
      <ol aria-live="polite" className="flex max-h-48 flex-col gap-1 overflow-y-auto font-mono text-[12px] text-muted">
        {job.log.length === 0 ? <li>Aguardando o serviço de cópias…</li> : job.log.map((l, i) => <li key={i}>{l.replace(/^\S+ /, '')}</li>)}
      </ol>
    </Panel>
  );
}

function RestoreDialog({ backup, onClose, onDone }: { backup: Backup; onClose: () => void; onDone: (msg: string) => void }) {
  const [scope, setScope] = useState<'tenant' | 'full'>('tenant');
  const [tenantId, setTenantId] = useState(backup.tenants[0]?.id ?? '');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const tenant = backup.tenants.find((t) => t.id === tenantId);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api('POST', `/api/v1/platform/backups/${encodeURIComponent(backup.name)}/restore`, { scope, tenantId: scope === 'tenant' ? tenantId : undefined, confirm });
      onDone(scope === 'tenant' ? `Restauração de "${tenant?.name}" pedida. Acompanhe abaixo.` : 'Restauração do banco inteiro pedida. Em alguns minutos o CRM volta com os dados da cópia; pode ser preciso entrar de novo.');
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2 : new ApiError(0, 'error', 'Não foi possível pedir a restauração.'));
      setBusy(false);
    }
  }

  return (
    <Dialog open title="Restaurar cópia" description={`Cópia de ${dateTime.format(new Date(backup.createdAt))} (${KIND[backup.kind].toLowerCase()})`} onClose={onClose} width={600}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {err && !err.fieldError('confirm') ? <Alert tone="error">{err.fieldError('tenantId') ?? err.title}</Alert> : null}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-[13px] font-medium">O que restaurar</legend>
          <label className="flex min-h-11 items-start gap-2.5">
            <input type="radio" name="escopo" checked={scope === 'tenant'} onChange={() => setScope('tenant')} className="mt-1 size-[18px] accent-[var(--primary)]" />
            <span><span className="font-medium">Uma empresa</span><span className="block text-[13px] text-muted">Só a empresa escolhida volta ao momento da cópia (dados e arquivos). As outras não mudam. Se ela foi excluída, volta a existir.</span></span>
          </label>
          <label className="flex min-h-11 items-start gap-2.5">
            <input type="radio" name="escopo" checked={scope === 'full'} onChange={() => setScope('full')} className="mt-1 size-[18px] accent-[var(--primary)]" />
            <span><span className="font-medium">O banco inteiro</span><span className="block text-[13px] text-muted">Todas as empresas, usuários e configurações voltam ao momento da cópia. O que foi feito depois dela some. Todos precisam entrar de novo.</span></span>
          </label>
        </fieldset>
        {scope === 'tenant' ? (
          <Select label="Empresa" value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
            {backup.tenants.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.slug})</option>)}
          </Select>
        ) : null}
        <Alert tone="info">
          Antes de restaurar, o CRM faz sozinho uma cópia do estado atual (tipo &ldquo;Antes de restaurar&rdquo;), para desfazer se for preciso.
          {backup.includesFiles ? '' : ' Esta cópia tem só o banco: os arquivos anexados continuam como estão.'}
        </Alert>
        <Field label="Digite RESTAURAR para confirmar" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" error={err?.fieldError('confirm')} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="danger" loading={busy} disabled={confirm !== 'RESTAURAR' || (scope === 'tenant' && !tenantId)}>
            <RotateCcw size={16} aria-hidden />{scope === 'tenant' ? `Restaurar ${tenant?.name ?? 'a empresa'}` : 'Restaurar o banco inteiro'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
