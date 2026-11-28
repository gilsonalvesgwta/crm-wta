'use client';
import { useEffect, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { ApiError, api, apiUpload } from '@/lib/api';
import type { VoiceAudio } from '@/lib/voice';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { VoiceRecorder } from './media';

/**
 * Áudio da ligação: escolhe da biblioteca de mídia, grava na hora pelo
 * microfone ou envia um arquivo (MP3, WAV, M4A, OGG). Tudo vira MP3 na
 * biblioteca e dá para ouvir antes.
 */
export function VoiceAudioPicker({ value, onChange, error, label = 'Áudio da ligação *' }: {
  value: string; onChange: (id: string) => void; error?: string; label?: string;
}) {
  const [items, setItems] = useState<VoiceAudio[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<{ items: VoiceAudio[] }>('GET', '/api/v1/voice/audios').then((r) => setItems(r.items)).catch(() => setItems([]));
  }, []);
  useEffect(() => {
    setUrl(null);
    if (!value) return;
    let live = true;
    api<{ url: string }>('GET', `/api/v1/instagram/media/${value}/url`).then((r) => { if (live) setUrl(r.url); }).catch(() => undefined);
    return () => { live = false; };
  }, [value]);

  async function send(f: File) {
    setBusy(true);
    setErr(null);
    try {
      const a = await apiUpload<VoiceAudio>('/api/v1/voice/audios', f);
      setItems((cur) => [a, ...(cur ?? [])]);
      onChange(a.id);
    } catch (e) {
      setErr(e instanceof ApiError ? (e.errors[0]?.message ?? e.title) : 'Não foi possível enviar o áudio.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Select label={label} value={value} onChange={(e) => onChange(e.target.value)} error={error}>
        <option value="">{items === null ? 'Carregando…' : items.length ? 'Escolha um áudio da biblioteca' : 'Nenhum áudio ainda: grave ou envie abaixo'}</option>
        {(items ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </Select>
      <div className="flex flex-wrap items-center gap-2">
        <VoiceRecorder disabled={busy} onRecorded={(f) => void send(f)} onError={setErr} />
        <button type="button" disabled={busy} onClick={() => input.current?.click()}
          className="inline-flex h-10 items-center gap-2 rounded-[6px] px-3.5 text-sm font-medium text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-60">
          <Upload size={16} aria-hidden />Enviar arquivo
        </button>
        <input ref={input} type="file" accept="audio/*" className="sr-only" tabIndex={-1} aria-hidden
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void send(f); }} />
        {busy ? <Spinner label="Preparando o áudio" /> : null}
      </div>
      {url ? <audio controls src={url} className="h-10 w-full max-w-md" aria-label="Ouvir o áudio escolhido" /> : null}
      {err ? <p className="text-[13px] text-bad" role="alert">{err}</p> : null}
      <p className="text-[12px] text-muted">Grave falando devagar e em ambiente silencioso; até 3 minutos (o ideal é de 20 a 40 segundos). Diga no fim o que apertar, ex.: “Aperte 1 para receber a oferta no WhatsApp”.</p>
    </div>
  );
}
