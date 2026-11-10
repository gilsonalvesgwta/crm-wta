'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Download, FileUp } from 'lucide-react';
import { ApiError, api, apiUpload } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { fmtDateTime } from '@/lib/crm';
import { useSession } from '@/components/shell/session';
import { useFields, usePipelines } from '@/components/crm/data';
import { TagPicker } from '@/components/crm/pickers';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Empty, LoadError, Loading } from '@/components/ui/states';
import { PageHeader } from '@/components/ui/misc';
import { ImportTemplate } from '@/components/crm/import-template';

type Entity = 'contacts' | 'organizations' | 'deals';
type Upload = { fileId: string; headers: string[]; totalRows: number; sample: string[][]; suggestedMapping: Record<string, string>; targets: string[]; detectedEntity?: Entity | null };
type ImportJob = {
  id: string; entity: Entity; status: 'pending' | 'processing' | 'done' | 'failed' | 'canceled'; totalRows: number; processedRows: number;
  createdCount: number; updatedCount: number; skippedCount: number; errorCount: number; error: string | null; createdAt: string; finishedAt: string | null;
  fileName: string; createdBy: string | null;
};
type RowError = { row: number; status: string; errors: { field: string; message: string }[] };

const TARGET_LABEL: Record<string, string> = {
  firstName: 'Nome', lastName: 'Sobrenome', fullName: 'Nome completo', email: 'E-mail', email2: 'E-mail 2', email3: 'E-mail 3',
  phone: 'Telefone', phone2: 'Telefone 2', phone3: 'Telefone 3', phone4: 'Telefone 4',
  title: 'Título do negócio', value: 'Valor', pipeline: 'Funil (nome)', stage: 'Etapa (nome)', status: 'Situação (andamento, ganho, perdido)',
  contactName: 'Pessoa de contato (nome)', contactEmail: 'E-mail da pessoa', contactPhone: 'Telefone da pessoa',
  expectedCloseDate: 'Previsão de fechamento', nextActivityDate: 'Próxima atividade (vira tarefa)', closedAt: 'Data de ganho ou perda', lostReason: 'Motivo da perda',
  jobTitle: 'Cargo', organization: 'Organização (nome)', taxId: 'CPF / CNPJ', birthday: 'Aniversário', tags: 'Etiquetas (separadas por vírgula)',
  ownerEmail: 'Responsável (e-mail ou nome)', source: 'Origem (utm_source)', medium: 'Mídia (utm_medium)', campaign: 'Campanha (utm_campaign)',
  city: 'Cidade', state: 'UF', name: 'Nome', legalName: 'Razão social', website: 'Site', industry: 'Segmento',
};
const ENTITY_LABEL: Record<Entity, string> = { contacts: 'Contatos', organizations: 'Organizações', deals: 'Negócios' };
const STATUS: Record<ImportJob['status'], { label: string; tone: 'neutral' | 'info' | 'ok' | 'bad' | 'warn' }> = {
  pending: { label: 'Na fila', tone: 'neutral' }, processing: { label: 'Importando', tone: 'info' }, done: { label: 'Concluída', tone: 'ok' },
  failed: { label: 'Falhou', tone: 'bad' }, canceled: { label: 'Cancelada', tone: 'warn' },
};

export default function ImportPage() {
  const { can } = useSession();
  const [entity, setEntity] = useState<Entity>('contacts');
  const [funil, setFunil] = useState<string | null>(null);
  // Vindo de Negócios › Importar: já abre em negócios, no funil que estava aberto.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get('tipo') === 'negocios') setEntity('deals');
    setFunil(p.get('funil'));
  }, []);
  const [upload, setUpload] = useState<Upload | null>(null);
  const [job, setJob] = useState<string | null>(null);
  const history = useLoad(() => api<ImportJob[]>('GET', '/api/v1/imports'), [job]);

  if (!can('contacts:import_export')) return <div className="mx-auto max-w-5xl"><LoadError error={new ApiError(403, 'forbidden', '')} /></div>;
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <PageHeader back={entity === 'deals' ? { href: '/negocios', label: 'Negócios' } : { href: '/contatos', label: 'Contatos' }} title="Importar planilha" subtitle="CSV com cabeçalho na primeira linha, até 50 mil linhas. Excel: Salvar como › CSV. Aceita a exportação do Pipedrive." />
      {job ? <Progress id={job} onAgain={() => { setJob(null); setUpload(null); }} />
        : !upload ? <UploadStep entity={entity} setEntity={setEntity} onUploaded={setUpload} />
        : <MappingStep entity={entity} upload={upload} defaultPipeline={funil} onBack={() => setUpload(null)} onStarted={setJob} />}
      <Panel title="Importações anteriores">
        {history.error ? <LoadError error={history.error} retry={history.reload} /> : !history.data ? <Loading /> : !history.data.length ? <p className="text-[13px] text-muted">Nenhuma ainda.</p> : (
          <ul className="flex flex-col">
            {history.data.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2.5 first:border-t-0 first:pt-0">
                <div><p className="font-medium">{h.fileName}</p><p className="text-[13px] text-muted">{ENTITY_LABEL[h.entity]} · {fmtDateTime.format(new Date(h.createdAt))} · {h.createdBy}</p></div>
                <div className="flex items-center gap-3 text-[13px]">
                  <span>{h.createdCount} criados · {h.updatedCount} atualizados · {h.skippedCount} ignorados · {h.errorCount} com erro</span>
                  <Badge tone={STATUS[h.status].tone}>{STATUS[h.status].label}</Badge>
                  <button type="button" onClick={() => setJob(h.id)} className="font-medium text-accent hover:underline">Detalhes</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function UploadStep({ entity, setEntity, onUploaded }: { entity: Entity; setEntity: (e: Entity) => void; onUploaded: (u: Upload) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function send(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      let u = await apiUpload<Upload>(`/api/v1/imports/upload?entity=${entity}`, file);
      // Exportação do Pipedrive (ou outra com prefixo "Pessoa - ", "Negócio - "): troca para o tipo certo sozinho.
      if (u.detectedEntity && u.detectedEntity !== entity) {
        u = await apiUpload<Upload>(`/api/v1/imports/upload?entity=${u.detectedEntity}`, file);
        setEntity(u.detectedEntity!);
      }
      onUploaded(u);
    } catch (e) {
      setErr(e instanceof ApiError ? (e.errors[0]?.message ?? e.title) : 'Não foi possível ler o arquivo.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }
  return (
    <Panel title="1. Escolha o arquivo">
      <div className="flex flex-col gap-4">
        <Select label="O que a planilha tem" value={entity} onChange={(e) => setEntity(e.target.value as typeof entity)} className="max-w-xs">
          <option value="contacts">Contatos (pessoas)</option><option value="organizations">Organizações (empresas)</option><option value="deals">Negócios</option>
        </Select>
        <div className="flex flex-col items-center gap-3 rounded-[10px] border-2 border-dashed border-line-strong px-6 py-10 text-center"
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void send(e.dataTransfer.files[0]); }}>
          <FileUp size={28} className="text-muted" aria-hidden />
          <p className="font-medium">Arraste o CSV aqui</p>
          <p className="text-[13px] text-muted">Separado por vírgula ou ponto e vírgula. Acentos em UTF-8 ou no padrão do Excel.</p>
          <input ref={input} type="file" accept=".csv,.txt,text/csv" className="sr-only" id="csv" aria-label="Escolher arquivo CSV" tabIndex={-1} onChange={(e) => send(e.target.files?.[0])} />
          <Button loading={busy} onClick={() => input.current?.click()}>Escolher arquivo</Button>
        </div>
        {err ? <Alert tone="error">{err}</Alert> : null}
        <ImportTemplate entity={entity} />
      </div>
    </Panel>
  );
}

function MappingStep({ entity, upload, defaultPipeline, onBack, onStarted }: { entity: Entity; upload: Upload; defaultPipeline: string | null; onBack: () => void; onStarted: (id: string) => void }) {
  const { data: defs } = useFields(entity === 'contacts' ? 'contact' : entity === 'deals' ? 'deal' : 'organization');
  const pipelines = (usePipelines().data ?? []).filter((p) => !p.archived);
  const [pipelineId, setPipelineId] = useState(defaultPipeline ?? '');
  const [stageId, setStageId] = useState('');
  const pipe = pipelines.find((p) => p.id === pipelineId) ?? pipelines[0];
  const openStages = (pipe?.stages ?? []).filter((x) => x.kind === 'open');
  const [mapping, setMapping] = useState<Record<string, string>>(upload.suggestedMapping);
  const [duplicate, setDuplicate] = useState<'skip' | 'update' | 'create'>('skip');
  const [tags, setTags] = useState<string[]>([]);
  const [consent, setConsent] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const label = (t: string) => TARGET_LABEL[t] ?? (t.startsWith('custom.') ? (defs?.find((d) => d.key === t.slice(7))?.label ?? t.slice(7)) : t);
  const used = new Set(Object.values(mapping).filter(Boolean));
  const hasName = entity === 'contacts' ? used.has('firstName') || used.has('fullName') : entity === 'deals' ? used.has('title') || used.has('contactName') : used.has('name');

  async function start() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ id: string }>('POST', '/api/v1/imports', {
        fileId: upload.fileId, entity, mapping: Object.fromEntries(Object.entries(mapping).filter(([, v]) => v)),
        options: {
          duplicate, tagIds: tags, consentSource: entity === 'contacts' && consent ? consent : null,
          ...(entity === 'deals' ? { pipelineId: pipe?.id ?? null, stageId: stageId || null } : {}),
        },
      });
      onStarted(r.id);
    } catch (e) {
      setErr(e instanceof ApiError ? (e.errors[0]?.message ?? e.title) : 'Não foi possível iniciar.');
      setBusy(false);
    }
  }

  return (
    <Panel title="2. Ligue as colunas aos campos" description={`${upload.totalRows.toLocaleString('pt-BR')} linhas encontradas. Colunas sem campo são ignoradas.`}>
      <div className="flex flex-col gap-5">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead><tr className="border-b border-line text-[12px] text-muted"><th scope="col" className="py-2 pr-3 font-medium">Coluna da planilha</th><th scope="col" className="py-2 pr-3 font-medium">Exemplos</th><th scope="col" className="py-2 font-medium">Campo no CRM</th></tr></thead>
            <tbody>
              {upload.headers.map((h, i) => (
                <tr key={h} className="border-b border-line last:border-0">
                  <td className="py-2.5 pr-3 font-medium">{h}</td>
                  <td className="max-w-[260px] py-2.5 pr-3 text-[13px] text-muted"><span className="line-clamp-2">{upload.sample.map((r) => r[i]).filter(Boolean).slice(0, 3).join(' · ')}</span></td>
                  <td className="py-2.5">
                    <select aria-label={`Campo para a coluna ${h}`} value={mapping[h] ?? ''} onChange={(e) => setMapping({ ...mapping, [h]: e.target.value })}
                      className="h-10 w-full rounded-[6px] border border-line-strong bg-surface px-2 text-sm">
                      <option value="">Não importar</option>
                      {upload.targets.map((t) => <option key={t} value={t} disabled={used.has(t) && mapping[h] !== t}>{label(t)}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {entity === 'deals' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Funil que recebe os negócios" value={pipe?.id ?? ''} onChange={(e) => { setPipelineId(e.target.value); setStageId(''); }}>
              {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <Select label="Etapa (quando a planilha não diz)" value={stageId} onChange={(e) => setStageId(e.target.value)}>
              <option value="">{openStages[0] ? `${openStages[0].name} (primeira)` : 'Primeira etapa'}</option>
              {openStages.slice(1).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
          </div>
        ) : null}
        {entity === 'deals' ? (
          <Alert tone="info">A pessoa de cada negócio é achada pelo e-mail ou telefone; sem eles, pelo nome (entre pessoas com o mesmo nome, a que ainda não tem negócio). Importe os contatos antes para os negócios caírem nas pessoas certas.</Alert>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label={entity === 'deals' ? 'Se o negócio já existir (mesmo título e pessoa)' : 'Se já existir (mesmo e-mail ou telefone)'} value={duplicate} onChange={(e) => setDuplicate(e.target.value as typeof duplicate)}>
            <option value="skip">Ignorar a linha</option><option value="update">Completar o cadastro existente</option><option value="create">Criar outro mesmo assim</option>
          </Select>
          {entity === 'contacts' ? <Field label="Consentimento de e-mail (opcional)" value={consent} onChange={(e) => setConsent(e.target.value)} hint="Preencha só se todos autorizaram. Ex.: inscritos na newsletter." /> : null}
        </div>
        <TagPicker label="Etiqueta para todos os importados (opcional)" value={tags} onChange={setTags} />
        {!hasName ? <Alert tone="warning">{entity === 'deals' ? 'Escolha a coluna do título do negócio (ou da pessoa de contato) para continuar.' : 'Escolha a coluna do nome para continuar.'}</Alert> : null}
        {err ? <Alert tone="error">{err}</Alert> : null}
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button variant="ghost" onClick={onBack}>Trocar arquivo</Button>
          <Button loading={busy} disabled={!hasName} onClick={start}>Importar {upload.totalRows.toLocaleString('pt-BR')} linhas</Button>
        </div>
      </div>
    </Panel>
  );
}

function Progress({ id, onAgain }: { id: string; onAgain: () => void }) {
  const job = useLoad(() => api<ImportJob>('GET', `/api/v1/imports/${id}`), [id]);
  const errors = useLoad(() => (job.data && (job.data.status === 'done' || job.data.status === 'failed') ? api<RowError[]>('GET', `/api/v1/imports/${id}/errors`) : Promise.resolve(null)), [id, job.data?.status]);
  const running = job.data && (job.data.status === 'pending' || job.data.status === 'processing');
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void job.reload(), 2000);
    return () => clearInterval(t);
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  if (job.error) return <LoadError error={job.error} retry={job.reload} />;
  const j = job.data;
  if (!j) return <Loading />;
  const pct = j.totalRows ? Math.round((j.processedRows / j.totalRows) * 100) : 0;

  function downloadErrors() {
    const rows = [['Linha', 'Situação', 'Campo', 'Mensagem'], ...(errors.data ?? []).flatMap((r) => r.errors.map((e) => [String(r.row), r.status === 'error' ? 'Erro' : r.status === 'skipped' ? 'Ignorada' : 'Importada com aviso', e.field, e.message]))];
    const csv = '﻿' + rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `erros-importacao-${id.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Panel title={`3. ${running ? 'Importando' : 'Resultado'}: ${j.fileName}`} actions={!running ? <Button variant="secondary" onClick={onAgain}>Nova importação</Button> : undefined}>
      <div className="flex flex-col gap-4">
        <div>
          <div className="mb-1.5 flex justify-between text-[13px]"><span><Badge tone={STATUS[j.status].tone}>{STATUS[j.status].label}</Badge></span><span className="tabular-nums">{j.processedRows.toLocaleString('pt-BR')} de {j.totalRows.toLocaleString('pt-BR')} ({pct}%)</span></div>
          <div role="progressbar" aria-label="Progresso da importação" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-2.5 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[['Criados', j.createdCount, 'text-ok'], ['Atualizados', j.updatedCount, ''], ['Ignorados', j.skippedCount, 'text-warn'], ['Com erro', j.errorCount, 'text-bad']].map(([l, n, c]) => (
            <div key={String(l)} className="rounded-[8px] border border-line p-3"><dt className="text-[12px] text-muted">{l}</dt><dd className={`text-xl font-semibold tabular-nums ${c}`}>{Number(n).toLocaleString('pt-BR')}</dd></div>
          ))}
        </dl>
        {j.error ? <Alert tone="error">{j.error}</Alert> : null}
        {running ? <p className="text-[13px] text-muted">Pode sair desta tela: a importação continua e você recebe um aviso quando terminar.</p> : null}
        {errors.data?.length ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">Linhas com aviso</h3><Button variant="secondary" onClick={downloadErrors}><Download size={16} aria-hidden />Baixar lista</Button></div>
            <ul className="max-h-72 overflow-y-auto rounded-[8px] border border-line">
              {errors.data.slice(0, 200).map((r) => (
                <li key={r.row} className="border-b border-line px-3 py-2 text-[13px] last:border-0"><span className="font-medium">Linha {r.row}</span> · {r.errors.map((e) => e.message).join(' ')}</li>
              ))}
            </ul>
          </div>
        ) : !running && j.status === 'done' ? <Empty title="Tudo certo">Todas as linhas foram processadas sem aviso. {j.entity === 'deals'
          ? <Link href="/negocios?visao=lista&status=all" className="font-medium text-accent">Ver negócios</Link>
          : <Link href="/contatos" className="font-medium text-accent">Ver contatos</Link>}</Empty> : null}
      </div>
    </Panel>
  );
}
