'use client';
import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, ExternalLink, FileText, Film, Image as ImageIcon, Phone, Plus, RefreshCw, Reply, Trash2, Type, Upload, X } from 'lucide-react';
import { ApiError, api, apiUpload } from '@/lib/api';
import { bytes, type MediaItem } from '@/lib/instagram';
import { useLoad } from '@/lib/use-load';
import { dateTime } from '@/lib/admin-types';
import { fillTemplate, TEMPLATE_STATUS, templateVariables, type ChannelAccount, type WaTemplate } from '@/lib/messages';
import { useSession } from '@/components/shell/session';
import { Panel } from '@/components/ui/panel';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Confirm } from '@/components/ui/confirm';
import { Dialog } from '@/components/ui/dialog';
import { LoadError, Loading } from '@/components/ui/states';

const CATEGORY: Record<WaTemplate['category'], string> = { MARKETING: 'Marketing', UTILITY: 'Utilidade', AUTHENTICATION: 'Autenticação' };

export default function TemplatesPage() {
  return <Suspense><Templates /></Suspense>;
}

function Templates() {
  const { can } = useSession();
  const search = useSearchParams();
  const accounts = useLoad(() => api<{ accounts: ChannelAccount[] }>('GET', '/api/v1/channels').then((r) => r.accounts.filter((a) => a.kind === 'whatsapp_cloud')));
  const [accountId, setAccountId] = useState(search.get('conta') ?? '');
  const acc = accounts.data?.find((a) => a.id === accountId) ?? accounts.data?.[0];
  const list = useLoad(() => (acc ? api<{ items: WaTemplate[] }>('GET', `/api/v1/whatsapp-templates?accountId=${acc.id}`) : Promise.resolve({ items: [] })), [acc?.id]);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<WaTemplate | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const edit = can('campaigns:edit');

  if (accounts.error) return <LoadError error={accounts.error} retry={accounts.reload} />;
  if (!accounts.data) return <Loading />;

  async function sync() {
    if (!acc) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ synced: number }>('POST', '/api/v1/whatsapp-templates/sync', { accountId: acc.id });
      setMsg(`${r.synced} modelo(s) atualizados com a Meta.`);
      await list.reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.title : 'Não foi possível sincronizar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Link href="/configuracoes/canais" className="inline-flex w-fit items-center gap-1 text-[13px] font-medium text-muted hover:text-ink"><ArrowLeft size={14} aria-hidden />Canais</Link>
      {msg ? <Alert tone="success">{msg}</Alert> : null}
      {err ? <Alert tone="error">{err}</Alert> : null}
      {accounts.data.length === 0 ? <Alert tone="info">Nenhum número do WhatsApp oficial. Adicione em Configurações › Canais.</Alert> : (
        <Panel title="Modelos de mensagem do WhatsApp oficial"
          description="Para começar uma conversa (ou responder depois de 24 horas) e para campanhas, o WhatsApp oficial só aceita modelos aprovados pela Meta. A aprovação costuma levar de minutos a algumas horas."
          actions={<div className="flex flex-wrap gap-2">
            <Button variant="secondary" loading={busy} onClick={() => void sync()}><RefreshCw size={16} aria-hidden />Sincronizar com a Meta</Button>
            {edit ? <Button onClick={() => setCreating(true)}><Plus size={16} aria-hidden />Novo modelo</Button> : null}
          </div>}>
          <div className="flex flex-col gap-4">
            {accounts.data.length > 1 ? (
              <Select label="Número" value={acc?.id ?? ''} onChange={(e) => setAccountId(e.target.value)} className="max-w-sm">
                {accounts.data.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            ) : null}
            {!list.data ? <Loading /> : list.data.items.length === 0 ? <p className="text-[13px] text-muted">Nenhum modelo ainda. Crie um ou sincronize os que já existem na Meta.</p> : (
              <ul className="flex flex-col">
                {list.data.items.map((t) => {
                  const st = TEMPLATE_STATUS[t.status] ?? { label: t.status, tone: 'neutral' as const };
                  return (
                    <li key={t.id} className="flex flex-wrap items-start justify-between gap-3 border-t border-line py-3 first:border-t-0 first:pt-0">
                      <div className="min-w-0 max-w-2xl">
                        <p className="flex flex-wrap items-center gap-2"><span className="font-mono text-[13px] font-semibold">{t.name}</span>
                          <Badge tone={st.tone}>{st.label}</Badge><span className="text-[12px] text-muted">{CATEGORY[t.category]} · {t.language} · {dateTime.format(new Date(t.updatedAt))}</span></p>
                        {t.header ? <p className="mt-1 text-sm font-semibold">{t.header}</p> : null}
                        {t.headerFormat && t.headerFormat !== 'TEXT' ? (
                          <p className="mt-1 text-[12px] text-muted">Cabeçalho: {t.headerFormat === 'IMAGE' ? 'imagem' : t.headerFormat === 'VIDEO' ? 'vídeo' : 'documento'}{t.headerFileName ? ` (${t.headerFileName})` : ''}</p>
                        ) : null}
                        <p className="whitespace-pre-wrap text-sm">{t.body}</p>
                        {t.footer ? <p className="text-[12px] text-muted">{t.footer}</p> : null}
                        {t.buttons.length ? <p className="mt-1 flex flex-wrap gap-1">{t.buttons.map((b) => <span key={b.text} className="rounded-full border border-line px-2 py-0.5 text-[12px]">{b.type === 'URL' ? '🔗 ' : b.type === 'PHONE_NUMBER' ? '📞 ' : ''}{b.text}</span>)}</p> : null}
                        {t.reason ? <p className="mt-1 text-[13px] text-bad">Motivo da Meta: {t.reason}</p> : null}
                      </div>
                      {edit ? <Button variant="ghost" aria-label={`Excluir o modelo ${t.name}`} onClick={() => setRemoving(t)}><Trash2 size={16} aria-hidden /></Button> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Panel>
      )}
      {creating && acc ? <TemplateDialog accountId={acc.id} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); setMsg('Modelo enviado para a Meta aprovar.'); void list.reload(); }} /> : null}
      <Confirm open={!!removing} title={`Excluir o modelo ${removing?.name}?`} confirmLabel="Excluir"
        onConfirm={async () => {
          const t = removing!;
          setRemoving(null);
          try { await api('DELETE', `/api/v1/whatsapp-templates/${t.id}`); setMsg('Modelo excluído na Meta e no CRM.'); await list.reload(); } catch (e) { setErr(e instanceof ApiError ? e.title : 'Não foi possível excluir.'); }
        }}
        onCancel={() => setRemoving(null)}>
        O modelo é apagado também na Meta. Campanhas que usam este modelo deixam de poder sair.
      </Confirm>
    </div>
  );
}

type HeaderKind = 'NONE' | 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT';
type Btn = { type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER'; text: string; url: string; phone: string };
const HEADER_OPTIONS: { v: HeaderKind; label: string; icon: typeof FileText }[] = [
  { v: 'NONE', label: 'Nenhum', icon: X }, { v: 'TEXT', label: 'Título', icon: Type }, { v: 'IMAGE', label: 'Imagem', icon: ImageIcon },
  { v: 'VIDEO', label: 'Vídeo', icon: Film }, { v: 'DOCUMENT', label: 'Documento', icon: FileText },
];
const ACCEPT: Record<string, string> = { IMAGE: 'image/jpeg,image/png', VIDEO: 'video/mp4', DOCUMENT: 'application/pdf' };
const FITS: Record<string, (t: string) => boolean> = {
  IMAGE: (t) => t === 'image/jpeg' || t === 'image/png', VIDEO: (t) => t === 'video/mp4', DOCUMENT: (t) => t === 'application/pdf',
};
const BTN_LABEL: Record<Btn['type'], string> = { QUICK_REPLY: 'Resposta rápida', URL: 'Abrir link', PHONE_NUMBER: 'Ligar' };

function TemplateDialog({ accountId, onClose, onSaved }: { accountId: string; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({ name: '', category: 'MARKETING', language: 'pt_BR', header: '', body: '', footer: '', examples: [] as string[] });
  const [headerKind, setHeaderKind] = useState<HeaderKind>('NONE');
  const [file, setFile] = useState<MediaItem | null>(null);
  const [buttons, setButtons] = useState<Btn[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const set = (p: Partial<typeof v>) => setV((c) => ({ ...c, ...p }));
  const n = templateVariables(v.body);
  const setBtn = (i: number, p: Partial<Btn>) => setButtons((bs) => bs.map((b, j) => (j === i ? { ...b, ...p } : b)));
  const count = (t: Btn['type']) => buttons.filter((b) => b.type === t).length;
  const btnErr = (i: number, f: string) => err?.errors.find((e) => e.field === `buttons.${i}.${f}`)?.message;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api('POST', '/api/v1/whatsapp-templates', {
        accountId, name: v.name, category: v.category, language: v.language, body: v.body, footer: v.footer || null, examples: v.examples.slice(0, n),
        headerFormat: headerKind === 'NONE' ? null : headerKind, header: headerKind === 'TEXT' ? v.header || null : null,
        headerFileId: headerKind !== 'NONE' && headerKind !== 'TEXT' ? file?.id ?? null : null,
        buttons: buttons.map((b) => ({ type: b.type, text: b.text, ...(b.type === 'URL' ? { url: b.url } : {}), ...(b.type === 'PHONE_NUMBER' ? { phone: b.phone } : {}) })),
      });
      onSaved();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2 : new ApiError(0, 'error', 'Não foi possível criar.'));
      setBusy(false);
    }
  }

  return (
    <Dialog open title="Novo modelo de mensagem" description="A Meta analisa cada modelo antes de liberar o uso." onClose={onClose} width={980}>
      <form onSubmit={submit} noValidate className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-4">
          {err && (!err.errors.length || err.errors.some((x) => x.field === 'buttons')) ? <Alert tone="error">{err.fieldError('buttons') ?? err.title}</Alert> : null}
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Nome" value={v.name} onChange={(e) => set({ name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} placeholder="promocao_outubro"
              hint="Minúsculas, números e _." error={err?.fieldError('name')} className="sm:col-span-1" />
            <Select label="Categoria" value={v.category} onChange={(e) => set({ category: e.target.value })} error={err?.fieldError('category')}>
              <option value="MARKETING">Marketing (ofertas, novidades)</option>
              <option value="UTILITY">Utilidade (pedidos, lembretes)</option>
              <option value="AUTHENTICATION">Autenticação (códigos)</option>
            </Select>
            <Select label="Idioma" value={v.language} onChange={(e) => set({ language: e.target.value })}>
              <option value="pt_BR">Português (Brasil)</option><option value="es">Espanhol</option><option value="en_US">Inglês (EUA)</option>
            </Select>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-[13px] font-medium">Cabeçalho (opcional)</legend>
            <div role="radiogroup" aria-label="Tipo de cabeçalho" className="flex flex-wrap gap-1.5">
              {HEADER_OPTIONS.map((o) => (
                <button key={o.v} type="button" role="radio" aria-checked={headerKind === o.v}
                  onClick={() => { setHeaderKind(o.v); if (file && o.v !== 'NONE' && o.v !== 'TEXT' && !FITS[o.v]!(file.contentType)) setFile(null); }}
                  className={`inline-flex h-9 items-center gap-1.5 rounded-[6px] border px-3 text-[13px] ${headerKind === o.v ? 'border-primary bg-accent-soft font-medium' : 'border-line hover:bg-surface-2'}`}>
                  <o.icon size={14} aria-hidden />{o.label}
                </button>
              ))}
            </div>
            {headerKind === 'TEXT' ? <Field label="Título" value={v.header} onChange={(e) => set({ header: e.target.value })} maxLength={60} error={err?.fieldError('header')} hint={`${v.header.length}/60`} /> : null}
            {headerKind === 'IMAGE' || headerKind === 'VIDEO' || headerKind === 'DOCUMENT' ? (
              <HeaderFile kind={headerKind} value={file} onChange={setFile} error={err?.fieldError('headerFileId')} />
            ) : null}
          </fieldset>
          <Textarea label="Texto" value={v.body} onChange={(e) => set({ body: e.target.value })} rows={5} maxLength={1024} error={err?.fieldError('body')}
            hint="Use {{1}}, {{2}}… onde entram os dados de cada pessoa (nome, pedido…). Não comece nem termine com variável." />
          <div className="-mt-2"><Button type="button" variant="ghost" onClick={() => set({ body: `${v.body}{{${n + 1}}}` })}><Plus size={14} aria-hidden />Inserir variável {`{{${n + 1}}}`}</Button></div>
          {n ? (
            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="mb-1.5 text-[13px] font-medium">Exemplos das variáveis (a Meta pede para aprovar)</legend>
              {Array.from({ length: n }, (_, i) => (
                <Field key={i} label={`Exemplo de {{${i + 1}}}`} value={v.examples[i] ?? ''} placeholder={i === 0 ? 'Maria' : ''}
                  onChange={(e) => { const ex = [...v.examples]; ex[i] = e.target.value; set({ examples: ex }); }} />
              ))}
              {err?.fieldError('examples') ? <p className="text-[13px] text-bad sm:col-span-2">{err.fieldError('examples')}</p> : null}
            </fieldset>
          ) : null}
          <Field label="Rodapé (opcional)" value={v.footer} onChange={(e) => set({ footer: e.target.value })} maxLength={60} error={err?.fieldError('footer')} hint={`${v.footer.length}/60`} />
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-[13px] font-medium">Botões (opcional): respostas rápidas, até 2 links e 1 telefone</legend>
            {buttons.map((b, i) => (
              <div key={i} className="grid gap-2 rounded-[8px] border border-line p-2.5 sm:grid-cols-[170px_minmax(0,1fr)_auto] sm:items-end">
                <Select label={`Tipo do botão ${i + 1}`} value={b.type} onChange={(e) => setBtn(i, { type: e.target.value as Btn['type'] })}>
                  {(['QUICK_REPLY', 'URL', 'PHONE_NUMBER'] as const).map((t) => (
                    <option key={t} value={t} disabled={t !== b.type && ((t === 'URL' && count('URL') >= 2) || (t === 'PHONE_NUMBER' && count('PHONE_NUMBER') >= 1))}>{BTN_LABEL[t]}</option>
                  ))}
                </Select>
                <Field label={`Texto do botão ${i + 1}`} value={b.text} maxLength={25} onChange={(e) => setBtn(i, { text: e.target.value })} error={btnErr(i, 'text')} />
                <Button type="button" variant="ghost" aria-label={`Tirar o botão ${i + 1}`} onClick={() => setButtons(buttons.filter((_, j) => j !== i))} className="mb-0.5"><Trash2 size={16} aria-hidden /></Button>
                {b.type === 'URL' ? <Field className="sm:col-span-3" label={`Link do botão ${i + 1}`} type="url" value={b.url} placeholder="https://" onChange={(e) => setBtn(i, { url: e.target.value })} error={btnErr(i, 'url')} /> : null}
                {b.type === 'PHONE_NUMBER' ? <Field className="sm:col-span-3" label={`Telefone do botão ${i + 1}`} type="tel" value={b.phone} placeholder="+55 11 99999-0000" onChange={(e) => setBtn(i, { phone: e.target.value })} error={btnErr(i, 'phone')} /> : null}
              </div>
            ))}
            {buttons.length < 10 ? <Button type="button" variant="ghost" className="self-start" onClick={() => setButtons([...buttons, { type: 'QUICK_REPLY', text: '', url: 'https://', phone: '' }])}><Plus size={14} aria-hidden />Botão</Button> : null}
            <p className="text-[12px] text-muted">Deixe as respostas rápidas juntas (todas antes ou todas depois dos links e do telefone).</p>
          </fieldset>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button type="submit" loading={busy} disabled={!v.name || !v.body.trim()}>Enviar para aprovação</Button>
          </div>
        </div>
        <PhonePreview headerKind={headerKind} header={v.header} file={file} body={fillTemplate(v.body, v.examples)} footer={v.footer} buttons={buttons} />
      </form>
    </Dialog>
  );
}

/** Arquivo do cabeçalho: envia para a biblioteca de mídia ou escolhe um que já está lá. */
function HeaderFile({ kind, value, onChange, error }: { kind: 'IMAGE' | 'VIDEO' | 'DOCUMENT'; value: MediaItem | null; onChange: (m: MediaItem | null) => void; error?: string }) {
  const lib = useLoad(() => api<{ items: MediaItem[] }>('GET', '/api/v1/instagram/media').then((r) => r.items).catch(() => [] as MediaItem[]));
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [upErr, setUpErr] = useState<string | null>(null);
  const fits = (lib.data ?? []).filter((m) => FITS[kind]!(m.contentType));
  async function upload(f: File) {
    setBusy(true);
    setUpErr(null);
    try {
      const m = await apiUpload<MediaItem>('/api/v1/instagram/media', f);
      if (!FITS[kind]!(m.contentType)) setUpErr(kind === 'IMAGE' ? 'Use uma imagem JPG ou PNG.' : kind === 'VIDEO' ? 'Use um vídeo MP4.' : 'Use um PDF.');
      else onChange(m);
      await lib.reload();
    } catch (e) {
      setUpErr(e instanceof ApiError ? e.errors[0]?.message ?? e.title : 'Não foi possível enviar.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-2 rounded-[8px] border border-line p-3">
      <input ref={input} type="file" accept={ACCEPT[kind]} className="hidden" aria-label="Arquivo do cabeçalho"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" loading={busy} onClick={() => input.current?.click()}><Upload size={15} aria-hidden />Enviar {kind === 'IMAGE' ? 'imagem' : kind === 'VIDEO' ? 'vídeo' : 'documento'}</Button>
        {fits.length ? (
          <select aria-label="Escolher da biblioteca de mídia" value={value?.id ?? ''} onChange={(e) => onChange(fits.find((m) => m.id === e.target.value) ?? null)}
            className="h-10 min-w-0 flex-1 rounded-[6px] border border-line-strong bg-surface px-3 text-sm">
            <option value="">Ou escolha da biblioteca…</option>
            {fits.map((m) => <option key={m.id} value={m.id}>{m.name} ({bytes(m.size)})</option>)}
          </select>
        ) : null}
      </div>
      <p className="text-[12px] text-muted">{kind === 'IMAGE' ? 'JPG ou PNG, até 5 MB.' : kind === 'VIDEO' ? 'MP4, até 16 MB.' : 'PDF, até 25 MB.'} O arquivo fica na biblioteca de mídia e é o que chega para cada pessoa.</p>
      {value ? <p className="text-[13px]">Escolhido: <strong>{value.name}</strong></p> : null}
      {upErr || error ? <p className="text-[13px] text-bad">{upErr ?? error}</p> : null}
    </div>
  );
}

/** Prévia no celular, como a mensagem chega no WhatsApp. */
function PhonePreview({ headerKind, header, file, body, footer, buttons }: {
  headerKind: HeaderKind; header: string; file: MediaItem | null; body: string; footer: string; buttons: Btn[];
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (!file || headerKind !== 'IMAGE') return;
    let alive = true;
    api<{ url: string }>('GET', `/api/v1/instagram/media/${file.id}/url`).then((r) => { if (alive) setUrl(r.url); }).catch(() => undefined);
    return () => { alive = false; };
  }, [file, headerKind]);
  const Icon = headerKind === 'VIDEO' ? Film : headerKind === 'DOCUMENT' ? FileText : ImageIcon;
  return (
    <aside aria-label="Prévia no celular" className="order-first lg:order-none">
      <p className="mb-2 text-[12px] font-medium text-muted">Como chega</p>
      <div className="mx-auto w-full max-w-[300px] rounded-[28px] border-[6px] border-[#1f2937] bg-[#1f2937] shadow-lg">
        <div className="flex items-center gap-2 rounded-t-[22px] bg-[#075E54] px-3 py-2.5 text-white">
          <span aria-hidden className="size-7 rounded-full bg-white/30" />
          <span className="text-[13px] font-semibold">Sua empresa</span>
        </div>
        <div className="min-h-[360px] rounded-b-[22px] bg-[#ECE5DD] p-3">
          <div className="max-w-[240px] overflow-hidden rounded-[10px] bg-white text-[13px] text-[#111] shadow-sm">
            {headerKind === 'IMAGE' || headerKind === 'VIDEO' || headerKind === 'DOCUMENT' ? (
              url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={url} alt="" className="max-h-[160px] w-full object-cover" />
              ) : (
                <div className="flex h-[110px] flex-col items-center justify-center gap-1 bg-[#d9dde1] text-[#3c4043]">
                  <Icon size={28} aria-hidden />
                  <span className="max-w-[200px] truncate px-2 text-[11px]">{file?.name ?? (headerKind === 'DOCUMENT' ? 'Documento' : headerKind === 'VIDEO' ? 'Vídeo' : 'Imagem')}</span>
                </div>
              )
            ) : null}
            <div className="px-2.5 py-2">
              {headerKind === 'TEXT' && header ? <p className="mb-1 font-semibold">{header}</p> : null}
              <p className="whitespace-pre-wrap break-words">{body || 'O texto do modelo aparece aqui.'}</p>
              {footer ? <p className="mt-1 text-[11px] text-[#5f6368]">{footer}</p> : null}
              <p className="mt-0.5 text-right text-[10px] text-[#5f6368]">10:30</p>
            </div>
            {buttons.filter((b) => b.text.trim()).map((b, i) => (
              <p key={i} className="flex items-center justify-center gap-1.5 border-t border-[#eee] py-2 text-center text-[13px] font-medium text-[#0a6aa1]">
                {b.type === 'URL' ? <ExternalLink size={13} aria-hidden /> : b.type === 'PHONE_NUMBER' ? <Phone size={13} aria-hidden /> : <Reply size={13} aria-hidden />}{b.text}
              </p>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}
