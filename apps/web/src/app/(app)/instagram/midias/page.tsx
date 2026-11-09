'use client';
import { useRef, useState } from 'react';
import { FileText, Film, Image as ImageIcon, Music, Trash2, Upload } from 'lucide-react';
import { ApiError, api, apiUpload } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { dateTime } from '@/lib/admin-types';
import { bytes, type MediaItem } from '@/lib/instagram';
import { useSession } from '@/components/shell/session';
import { InstagramTabs } from '@/components/instagram/tabs';
import { PageHeader } from '@/components/ui/misc';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Confirm } from '@/components/ui/confirm';
import { Empty, LoadError, Loading } from '@/components/ui/states';

const ACCEPT = 'image/jpeg,image/png,video/mp4,video/quicktime,audio/mp4,audio/x-m4a,audio/aac,audio/wav,application/pdf';

function KindIcon({ type }: { type: string }) {
  const I = type.startsWith('image/') ? ImageIcon : type.startsWith('video/') ? Film : type.startsWith('audio/') ? Music : FileText;
  return <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-[8px] bg-surface-2 text-muted"><I size={18} /></span>;
}

export default function InstagramMediaPage() {
  const { can } = useSession();
  const lib = useLoad(() => api<{ items: MediaItem[]; usedBytes: number; quotaBytes: number }>('GET', '/api/v1/instagram/media'));
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [removing, setRemoving] = useState<MediaItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  if (!can('campaigns:view')) return <LoadError error={new ApiError(403, 'forbidden', '')} />;

  async function upload(files: FileList) {
    setBusy(true);
    setMsg(null);
    let ok = 0;
    for (const f of Array.from(files)) {
      try {
        await apiUpload('/api/v1/instagram/media', f);
        ok++;
      } catch (e) {
        setMsg({ tone: 'error', text: `${f.name}: ${e instanceof ApiError ? e.errors[0]?.message ?? e.title : 'não foi possível enviar.'}` });
      }
    }
    if (ok) setMsg((m) => m ?? { tone: 'success', text: ok === 1 ? 'Arquivo enviado.' : `${ok} arquivos enviados.` });
    setBusy(false);
    await lib.reload();
  }

  async function open(m: MediaItem) {
    const r = await api<{ url: string }>('GET', `/api/v1/instagram/media/${m.id}/url`);
    window.open(r.url, '_blank', 'noopener');
  }

  async function remove() {
    if (!removing) return;
    setDeleting(true);
    try {
      await api('DELETE', `/api/v1/instagram/media/${removing.id}`);
      await lib.reload();
    } finally {
      setDeleting(false);
      setRemoving(null);
    }
  }

  const pct = lib.data ? Math.min(100, (lib.data.usedBytes / lib.data.quotaBytes) * 100) : 0;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader title="Instagram" subtitle="Arquivos para mandar nos fluxos." />
      <InstagramTabs />
      <Panel title="Biblioteca de mídia" description="JPG ou PNG até 8 MB · MP4 ou MOV até 25 MB · M4A, AAC ou WAV até 25 MB · PDF até 25 MB"
        actions={can('campaigns:edit') ? (
          <>
            <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" aria-label="Escolher arquivos"
              onChange={(e) => { if (e.target.files?.length) void upload(e.target.files); e.target.value = ''; }} />
            <Button loading={busy} onClick={() => input.current?.click()}><Upload size={15} aria-hidden />Enviar arquivos</Button>
          </>
        ) : undefined}>
        <div className="flex flex-col gap-4">
          {lib.data ? (
            <div>
              <div className="flex justify-between text-[13px]"><span className="text-muted">Espaço usado</span><span className="font-medium">{bytes(lib.data.usedBytes)} de {bytes(lib.data.quotaBytes)}</span></div>
              <div className="mt-1.5 h-2 rounded-full bg-surface-2" role="meter" aria-label="Espaço usado" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
                <div className={`h-2 rounded-full ${pct > 90 ? 'bg-bad' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          ) : null}
          {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
          {lib.error ? <LoadError error={lib.error} retry={lib.reload} /> : !lib.data ? <Loading /> : !lib.data.items.length ? (
            <Empty title="Nenhum arquivo ainda">Envie imagens, vídeos, áudios ou PDFs para usar no bloco “Imagem, vídeo, áudio ou PDF” dos fluxos.</Empty>
          ) : (
            <ul className="-mx-5 divide-y divide-line">
              {lib.data.items.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-5 py-2.5">
                  <KindIcon type={m.contentType} />
                  <div className="min-w-0 flex-1">
                    <button type="button" onClick={() => void open(m)} className="block max-w-full truncate text-left font-medium hover:underline">{m.name}</button>
                    <p className="text-[13px] text-muted">{bytes(m.size)} · {dateTime.format(new Date(m.createdAt))}{m.uploadedBy ? ` · ${m.uploadedBy}` : ''}</p>
                  </div>
                  {can('campaigns:edit') ? (
                    <button type="button" aria-label={`Apagar ${m.name}`} onClick={() => setRemoving(m)} className="flex size-9 items-center justify-center rounded-[6px] text-muted hover:bg-bad-soft hover:text-bad"><Trash2 size={16} aria-hidden /></button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>
      <Confirm open={!!removing} title="Apagar este arquivo?" confirmLabel="Apagar" loading={deleting} onConfirm={remove} onCancel={() => setRemoving(null)}>
        Fluxos que mandam “{removing?.name}” vão pular esse passo. Mensagens já enviadas não mudam.
      </Confirm>
    </div>
  );
}
