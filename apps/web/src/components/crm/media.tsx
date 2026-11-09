'use client';
import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { Download, Expand, FileText, Mic, Square, Trash2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { fileSize } from '@/lib/crm';
import { Spinner } from '@/components/ui/spinner';

export type MediaFile = { id: string; name: string; contentType: string; sizeBytes: number };

const signedUrl = (id: string) => api<{ url: string }>('GET', `/api/v1/files/${id}/url`).then((r) => r.url);

/** O endereço assinado vence em minutos: pede outro e continua do mesmo ponto. */
export function useMediaRetry(fileId: string) {
  const retried = useRef(0);
  return (e: SyntheticEvent<HTMLMediaElement>) => {
    const el = e.currentTarget;
    const at = el.currentTime;
    const playing = !el.paused;
    if (retried.current > 2) return;
    retried.current++;
    signedUrl(fileId).then((url) => {
      el.src = url;
      el.currentTime = at;
      if (playing || at > 0) void el.play().catch(() => undefined);
    }).catch(() => undefined);
  };
}

/** Como mostrar o arquivo: o tipo da mensagem decide quando o arquivo é ambíguo (áudio do Instagram chega em MP4). */
export function mediaMode(contentType: string, kind?: string): 'image' | 'audio' | 'video' | 'pdf' | 'file' {
  const t = contentType.split(';')[0]!.trim();
  if (t.startsWith('image/') && t !== 'image/heic') return 'image';
  if (t.startsWith('audio/') || (kind === 'audio' && t.startsWith('video/'))) return 'audio';
  if (t.startsWith('video/')) return 'video';
  if (t === 'application/pdf') return 'pdf';
  return 'file';
}

export async function downloadFile(id: string) {
  window.open(await signedUrl(id), '_blank', 'noopener');
}

/**
 * Janela para ver o arquivo no CRM, sem baixar: imagem grande, vídeo com
 * player e PDF no leitor do navegador.
 */
export function MediaViewer({ file, mode, onClose }: { file: MediaFile; mode: 'image' | 'video' | 'pdf'; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const retry = useMediaRetry(file.id);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  useEffect(() => {
    let alive = true;
    let blobUrl: string | null = null;
    (async () => {
      try {
        const signed = await signedUrl(file.id);
        if (mode !== 'pdf') { if (alive) setUrl(signed); return; }
        // O PDF abre a partir de uma cópia no navegador: o endereço de download força baixar.
        const res = await fetch(signed, { credentials: 'same-origin' });
        if (!res.ok) throw new Error();
        blobUrl = URL.createObjectURL(new Blob([await res.arrayBuffer()], { type: 'application/pdf' }));
        if (alive) setUrl(blobUrl); else URL.revokeObjectURL(blobUrl);
      } catch {
        if (alive) setError('Não foi possível abrir o arquivo.');
      }
    })();
    return () => { alive = false; if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [file.id, mode]);
  return (
    <dialog ref={ref} aria-label={`Ver ${file.name}`} onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className="m-auto h-[calc(100dvh-32px)] w-[min(1100px,calc(100vw-32px))] max-h-none max-w-none overflow-hidden rounded-[12px] border border-line bg-[#0b0f14] p-0 text-white shadow-2xl backdrop:bg-black/70">
      <div className="flex h-full flex-col">
        <header className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
          <p className="min-w-0 flex-1 truncate text-sm font-medium">{file.name} <span className="text-white/60">· {fileSize(file.sizeBytes)}</span></p>
          <button type="button" onClick={() => void downloadFile(file.id)} className="flex h-9 items-center gap-1.5 rounded-[6px] px-3 text-[13px] hover:bg-white/10">
            <Download size={15} aria-hidden />Baixar
          </button>
          <button type="button" onClick={onClose} aria-label="Fechar" className="flex size-9 items-center justify-center rounded-[6px] hover:bg-white/10"><X size={18} aria-hidden /></button>
        </header>
        <div className="flex min-h-0 flex-1 items-center justify-center p-3">
          {error ? <p role="alert" className="text-sm">{error}</p> : !url ? <Spinner label="Abrindo o arquivo" /> : mode === 'image' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={file.name} className="max-h-full max-w-full object-contain" />
          ) : mode === 'video' ? (
            <video src={url} controls autoPlay playsInline onError={retry} className="max-h-full max-w-full"><track kind="captions" /></video>
          ) : (
            <iframe src={url} title={file.name} className="h-full w-full rounded-[6px] bg-white" />
          )}
        </div>
      </div>
    </dialog>
  );
}

/** Miniatura de imagem, player de áudio e de vídeo, ou cartão do documento; tudo abre no CRM. */
export function MediaPreview({ file, kind, out, autoPlay = false }: { file: MediaFile; kind?: string; out: boolean; autoPlay?: boolean }) {
  const mode = mediaMode(file.contentType, kind);
  const [url, setUrl] = useState<string | null>(null);
  const [viewing, setViewing] = useState(false);
  const retry = useMediaRetry(file.id);
  useEffect(() => {
    if (mode === 'pdf' || mode === 'file') return;
    let alive = true;
    signedUrl(file.id).then((u) => { if (alive) setUrl(u); }).catch(() => undefined);
    return () => { alive = false; };
  }, [file.id, mode]);
  const chip = `flex items-center gap-2 self-start rounded-[6px] px-2 py-1 text-[13px] ${out ? 'bg-black/10' : 'bg-surface-2'} hover:underline`;
  return (
    <div className="flex flex-col gap-1.5">
      {mode === 'image' && url ? (
        <button type="button" onClick={() => setViewing(true)} aria-label={`Ampliar a imagem ${file.name}`} className="self-start overflow-hidden rounded-[6px] focus-visible:ring-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={file.name} className="max-h-60 max-w-full cursor-zoom-in object-contain" />
        </button>
      ) : null}
      {mode === 'audio' && url ? (
        <audio controls autoPlay={autoPlay} preload="metadata" src={url} className="max-w-full" onError={retry}><track kind="captions" /></audio>
      ) : null}
      {mode === 'video' && url ? (
        <div className="relative self-start">
          <video controls preload="metadata" playsInline src={url} onError={retry} className="max-h-72 max-w-full rounded-[6px] bg-black"><track kind="captions" /></video>
          <button type="button" onClick={() => setViewing(true)} aria-label={`Ver o vídeo ${file.name} em tela grande`}
            className="absolute right-1.5 top-1.5 flex size-8 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"><Expand size={15} aria-hidden /></button>
        </div>
      ) : null}
      {mode === 'pdf' ? (
        <button type="button" onClick={() => setViewing(true)}
          className={`flex items-center gap-2.5 self-start rounded-[8px] border px-3 py-2 text-left ${out ? 'border-black/10 bg-black/5' : 'border-line bg-surface-2'} hover:border-primary`}>
          <FileText size={22} aria-hidden className="shrink-0 text-bad" />
          <span className="min-w-0"><span className="block max-w-[240px] truncate text-[13px] font-medium">{file.name}</span>
            <span className="block text-[12px] text-muted">PDF · {fileSize(file.sizeBytes)} · Ver documento</span></span>
        </button>
      ) : null}
      <button type="button" onClick={() => void downloadFile(file.id)} className={chip}>
        <Download size={14} aria-hidden /><span className="max-w-[220px] truncate">{mode === 'file' ? file.name : 'Baixar'}</span><span className="opacity-70">{fileSize(file.sizeBytes)}</span>
      </button>
      {viewing && (mode === 'image' || mode === 'video' || mode === 'pdf') ? <MediaViewer file={file} mode={mode} onClose={() => setViewing(false)} /> : null}
    </div>
  );
}

const MIME_CHOICES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];
const MAX_SECONDS = 300;

/**
 * Gravar áudio no CRM. Grava pelo microfone do navegador; o servidor converte
 * para o formato do canal (voz do WhatsApp ou áudio do Instagram).
 */
export function VoiceRecorder({ onRecorded, onError, disabled }: { onRecorded: (f: File) => void; onError: (msg: string) => void; disabled?: boolean }) {
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [secs, setSecs] = useState(0);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const cancelled = useRef(false);
  useEffect(() => {
    if (!rec) return;
    const t = setInterval(() => setSecs((s) => { if (s + 1 >= MAX_SECONDS) rec.stop(); return s + 1; }), 1000);
    return () => clearInterval(t);
  }, [rec]);
  useEffect(() => () => stream.current?.getTracks().forEach((t) => t.stop()), []);

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      onError('Este navegador não grava áudio. Use o Chrome, o Edge, o Firefox ou o Safari atualizados.');
      return;
    }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onError('O navegador não deixou usar o microfone. Libere o microfone para este site e tente de novo.');
      return;
    }
    const mimeType = MIME_CHOICES.find((m) => MediaRecorder.isTypeSupported(m));
    const r = new MediaRecorder(stream.current, mimeType ? { mimeType } : undefined);
    chunks.current = [];
    cancelled.current = false;
    r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
    r.onstop = () => {
      stream.current?.getTracks().forEach((t) => t.stop());
      setRec(null);
      if (cancelled.current || !chunks.current.length) return;
      const type = (r.mimeType || 'audio/webm').split(';')[0]!;
      const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
      onRecorded(new File(chunks.current, `gravacao.${ext}`, { type }));
    };
    r.start(250);
    setSecs(0);
    setRec(r);
  }

  if (rec) {
    return (
      <span className="flex items-center gap-2 rounded-full bg-bad-soft px-2 py-1 text-[13px] text-bad" role="status">
        <span aria-hidden className="size-2 animate-pulse rounded-full bg-bad" />
        Gravando {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}
        <button type="button" onClick={() => { cancelled.current = true; rec.stop(); }} aria-label="Descartar a gravação"
          className="flex size-7 items-center justify-center rounded-full hover:bg-surface"><Trash2 size={14} aria-hidden /></button>
        <button type="button" onClick={() => rec.stop()} aria-label="Parar a gravação"
          className="flex h-7 items-center gap-1 rounded-full bg-bad px-2.5 font-medium text-white"><Square size={12} aria-hidden />Parar</button>
      </span>
    );
  }
  return (
    <button type="button" onClick={() => void start()} disabled={disabled}
      className="inline-flex h-10 items-center gap-2 rounded-[6px] px-3.5 text-sm font-medium text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-60">
      <Mic size={16} aria-hidden />Gravar áudio
    </button>
  );
}
