'use client';
import { useEffect, useState } from 'react';
import { AudioLines } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { Panel } from '@/components/ui/panel';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { LoadError, Loading } from '@/components/ui/states';

type Model = 'gpt-4o-mini-transcribe' | 'gpt-4o-transcribe' | 'whisper-1';
type Settings = { provider: 'local' | 'openai'; localAvailable: boolean; openai: { configured: boolean; hint: string | null; model: Model } };

/** Configurações › Integrações: como transcrever as notas de áudio. */
export function TranscriptionSettings() {
  const s = useLoad(() => api<Settings>('GET', '/api/v1/integrations/transcription'));
  const [provider, setProvider] = useState<'local' | 'openai'>('local');
  const [model, setModel] = useState<Model>('gpt-4o-mini-transcribe');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (s.data) { setProvider(s.data.provider); setModel(s.data.openai.model); }
  }, [s.data]);

  if (s.error) return <LoadError error={s.error} retry={s.reload} />;
  if (!s.data) return <Loading />;
  const d = s.data;

  async function save(e: { preventDefault(): void }, removeKey = false) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const body: Record<string, unknown> = { provider: removeKey ? 'local' : provider, model };
      if (removeKey) body.openaiKey = null;
      else if (key.trim()) body.openaiKey = key.trim();
      const r = await api<Settings>('PUT', '/api/v1/integrations/transcription', body);
      s.setData(r);
      setKey('');
      setMsg({ tone: 'success', text: removeKey ? 'Chave da OpenAI removida.' : 'Transcrição salva.' });
    } catch (e2) {
      setMsg({ tone: 'error', text: e2 instanceof ApiError ? [e2.title, e2.errors[0]?.message].filter(Boolean).join(' ') : 'Não foi possível salvar.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Transcrição de áudio" description="As notas de áudio ganham o texto logo abaixo do player, para ler e copiar.">
      <form onSubmit={(e) => save(e)} className="flex flex-col gap-4 text-sm">
        {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-medium">Como transcrever</legend>
          <label className="flex items-start gap-2.5 rounded-[8px] border border-line p-3">
            <input type="radio" name="provider" className="mt-0.5 size-4 accent-[var(--primary)]" checked={provider === 'local'} onChange={() => setProvider('local')} />
            <span>
              <span className="flex flex-wrap items-center gap-2 font-medium">No próprio servidor (grátis)
                {d.localAvailable ? <Badge tone="ok">Disponível</Badge> : <Badge tone="bad">Não instalado</Badge>}</span>
              <span className="block text-[13px] text-muted">Sem custo e sem enviar o áudio para fora. Leva cerca de meio minuto a um minuto para cada minuto de áudio.</span>
            </span>
          </label>
          <label className="flex items-start gap-2.5 rounded-[8px] border border-line p-3">
            <input type="radio" name="provider" className="mt-0.5 size-4 accent-[var(--primary)]" checked={provider === 'openai'} onChange={() => setProvider('openai')} />
            <span>
              <span className="flex flex-wrap items-center gap-2 font-medium">OpenAI, com a chave da empresa
                {d.openai.configured ? <Badge tone="ok">Chave …{d.openai.hint}</Badge> : null}</span>
              <span className="block text-[13px] text-muted">Mais rápido e mais preciso (nomes, números). A OpenAI cobra por minuto de áudio na sua conta: centavos por minuto.</span>
            </span>
          </label>
        </fieldset>
        {provider === 'openai' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={d.openai.configured ? 'Trocar a chave da API (opcional)' : 'Chave da API da OpenAI'} type="password" autoComplete="off"
              placeholder={d.openai.configured ? `Chave atual termina em ${d.openai.hint}` : 'sk-…'} value={key} onChange={(e) => setKey(e.target.value)} />
            <Select label="Modelo" value={model} onChange={(e) => setModel(e.target.value as Model)}>
              <option value="gpt-4o-mini-transcribe">gpt-4o-mini-transcribe (mais barato)</option>
              <option value="gpt-4o-transcribe">gpt-4o-transcribe (mais preciso)</option>
              <option value="whisper-1">whisper-1</option>
            </Select>
            <p className="text-[13px] text-muted sm:col-span-2">
              Crie a chave em platform.openai.com › API keys. Ela fica guardada cifrada e não aparece de novo aqui. Ao salvar, o CRM confere a chave com a OpenAI.
            </p>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={busy} disabled={provider === 'openai' && !d.openai.configured && !key.trim()}>
            <AudioLines size={16} aria-hidden />Salvar transcrição
          </Button>
          {d.openai.configured ? <Button type="button" variant="ghost" disabled={busy} onClick={(e) => save(e, true)}>Remover a chave da OpenAI</Button> : null}
        </div>
      </form>
    </Panel>
  );
}
