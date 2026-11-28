'use client';
import Link from 'next/link';
import { Plus, Trash2 } from 'lucide-react';
import { phone } from '@/lib/crm';
import { CAMPAIGN_VARIABLES, EXTRA_WHEN, type ExtraWhen, type KeyAction, type VoiceSettings } from '@/lib/campaigns';
import type { SendAccount } from '@/lib/messages';
import { PROVIDERS, PROVIDER_STATUS, type VoiceProvider } from '@/lib/voice';
import { Select } from '@/components/ui/select';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { Alert } from '@/components/ui/alert';
import { TagPicker } from './pickers';
import { VoiceAudioPicker } from './voice-audio';

const blankKey = (): KeyAction => ({ label: '', tagId: null, optOut: false, whatsapp: false, sms: false, notifyOwner: false });

/** Conteúdo da campanha de voz: operadora, áudio, teclas e o WhatsApp/SMS que sai junto. */
export function VoiceContent({ providers, providerId, onProvider, audioFileId, onAudio, voice, onVoice, whatsapps, fieldErr }: {
  providers: VoiceProvider[]; providerId: string; onProvider: (id: string) => void;
  audioFileId: string; onAudio: (id: string) => void;
  voice: VoiceSettings; onVoice: (v: VoiceSettings) => void;
  whatsapps: SendAccount[]; fieldErr: (k: string) => string | undefined;
}) {
  const set = (p: Partial<VoiceSettings>) => onVoice({ ...voice, ...p });
  const chosen = providers.find((p) => p.id === providerId);
  const keys = Object.entries(voice.keys).sort(([a], [b]) => a.localeCompare(b));
  const free = '1234567890'.split('').filter((d) => !voice.keys[d]);
  const setKey = (d: string, k: KeyAction | null, newDigit?: string) => {
    const next = { ...voice.keys };
    delete next[d];
    if (k) next[newDigit ?? d] = k;
    set({ keys: next });
  };
  const usesKey = (what: 'whatsapp' | 'sms') => keys.some(([, k]) => k[what]);

  return (
    <div className="flex flex-col gap-5">
      {providers.length === 0 ? (
        <Alert tone="info">Nenhuma operadora de voz cadastrada. O administrador cadastra em <Link href="/configuracoes/canais" className="underline">Configurações › Canais</Link> (Twilio, Plivo, Telnyx, Zenvia, Infobip, central SIP própria ou outra com API).</Alert>
      ) : null}
      <Select label="Operadora que faz as ligações *" value={providerId} onChange={(e) => onProvider(e.target.value)} error={fieldErr('voiceProviderId')}>
        <option value="">Escolha a operadora</option>
        {providers.map((p) => <option key={p.id} value={p.id}>{p.name} · {PROVIDERS[p.provider].label} ({PROVIDER_STATUS[p.status].label.toLowerCase()})</option>)}
      </Select>
      {chosen && chosen.status !== 'ok' ? <Alert tone="warning">Esta operadora ainda não teve uma ligação de teste atendida. Teste em Configurações › Canais antes de ligar para a base.</Alert> : null}

      <VoiceAudioPicker value={audioFileId} onChange={onAudio} error={fieldErr('audioFileId')} />

      <fieldset className="flex flex-col gap-3 rounded-[10px] border border-line p-3">
        <legend className="px-1 text-[13px] font-semibold">Teclas</legend>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={voice.digits} onChange={(e) => set({ digits: e.target.checked })} className="size-[18px] accent-[var(--primary)]" />
          Esperar a pessoa apertar uma tecla depois do áudio
        </label>
        {voice.digits ? (
          <>
            {keys.map(([d, k]) => (
              <div key={d} className="flex flex-col gap-2 rounded-[8px] bg-surface-2 p-2.5">
                <div className="flex flex-wrap items-end gap-2">
                  <Select className="w-24" label="Tecla" value={d} onChange={(e) => setKey(d, k, e.target.value)}>
                    {[d, ...free].sort().map((x) => <option key={x} value={x}>{x}</option>)}
                  </Select>
                  <Field className="min-w-[180px] flex-1" label="O que significa" value={k.label} maxLength={80} placeholder="Ex.: Quero receber a oferta"
                    onChange={(e) => setKey(d, { ...k, label: e.target.value })} />
                  <button type="button" aria-label={`Remover a tecla ${d}`} onClick={() => setKey(d, null)}
                    className="mb-1.5 flex size-9 items-center justify-center rounded-[6px] text-muted hover:bg-surface hover:text-bad"><Trash2 size={15} aria-hidden /></button>
                </div>
                <div className="max-w-md">
                  <TagPicker label="Marcar com a etiqueta" value={k.tagId ? [k.tagId] : []}
                    onChange={(v) => setKey(d, { ...k, tagId: v.filter((x) => x !== k.tagId).at(-1) ?? (k.tagId && v.includes(k.tagId) ? k.tagId : null) })} />
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  {([['whatsapp', 'Mandar o WhatsApp'], ['sms', 'Mandar o SMS'], ['notifyOwner', 'Avisar o responsável'], ['optOut', 'Não ligar mais (descadastro)']] as const).map(([f, l]) => (
                    <label key={f} className="flex min-h-9 items-center gap-2">
                      <input type="checkbox" checked={!!k[f]} onChange={(e) => setKey(d, { ...k, [f]: e.target.checked })} className="size-4 accent-[var(--primary)]" />{l}
                    </label>
                  ))}
                </div>
              </div>
            ))}
            {free.length ? (
              <button type="button" onClick={() => setKey(free[0]!, blankKey())}
                className="inline-flex h-9 items-center gap-1.5 self-start rounded-[6px] border border-line bg-surface px-3 text-[13px] font-medium text-ink hover:bg-surface-2">
                <Plus size={15} aria-hidden />Adicionar tecla
              </button>
            ) : null}
            <p className="text-[12px] text-muted">Diga no áudio o que cada tecla faz. Quem apertar uma tecla conta como “atendeu”. Uma tecla de descadastro (ex.: 9) evita ligar de novo para quem não quer.</p>
          </>
        ) : null}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Tempo chamando" value={String(voice.ringSeconds)} onChange={(e) => set({ ringSeconds: Number(e.target.value) })}>
          {[15, 20, 25, 30, 40, 60].map((n) => <option key={n} value={n}>{n} segundos</option>)}
        </Select>
        <label className="flex min-h-11 items-center gap-2 self-end text-sm">
          <input type="checkbox" checked={voice.machineDetection} onChange={(e) => set({ machineDetection: e.target.checked })} className="size-[18px] accent-[var(--primary)]" />
          Identificar caixa postal (algumas operadoras cobram à parte)
        </label>
      </div>

      <fieldset className="flex flex-col gap-3 rounded-[10px] border border-line p-3">
        <legend className="px-1 text-[13px] font-semibold">WhatsApp junto (opcional)</legend>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={!!voice.whatsapp} disabled={!whatsapps.length && !voice.whatsapp}
            onChange={(e) => set({ whatsapp: e.target.checked ? { accountId: whatsapps[0]?.id ?? '', text: '', when: usesKey('whatsapp') ? 'key' : 'with_call' } : null })}
            className="size-[18px] accent-[var(--primary)]" />
          Mandar uma mensagem de WhatsApp {whatsapps.length ? '' : '(nenhum WhatsApp conectado)'}
        </label>
        {voice.whatsapp ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label="Pelo número" value={voice.whatsapp.accountId} error={fieldErr('voice.whatsapp.accountId')}
                onChange={(e) => set({ whatsapp: { ...voice.whatsapp!, accountId: e.target.value } })}>
                {whatsapps.map((a) => <option key={a.id} value={a.id}>{a.name}{a.address ? ` · ${phone(a.address)}` : ''}</option>)}
              </Select>
              <Select label="Quando" value={voice.whatsapp.when} onChange={(e) => set({ whatsapp: { ...voice.whatsapp!, when: e.target.value as ExtraWhen } })}>
                {Object.entries(EXTRA_WHEN).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </Select>
            </div>
            <Textarea label="Mensagem do WhatsApp *" rows={4} maxLength={4000} value={voice.whatsapp.text} error={fieldErr('voice.whatsapp.text')}
              onChange={(e) => set({ whatsapp: { ...voice.whatsapp!, text: e.target.value } })} placeholder="Oi {{primeiro_nome}}! Acabamos de ligar sobre a Black Friday. Veja a oferta: …" />
            <Vars onAdd={(v) => set({ whatsapp: { ...voice.whatsapp!, text: `${voice.whatsapp!.text}{{${v}}}` } })} />
            {voice.whatsapp.when === 'key' && !usesKey('whatsapp') ? <p className="text-[12px] text-warn">Marque “Mandar o WhatsApp” em alguma tecla.</p> : null}
          </>
        ) : null}
      </fieldset>

      <fieldset className="flex flex-col gap-3 rounded-[10px] border border-line p-3">
        <legend className="px-1 text-[13px] font-semibold">SMS junto (opcional)</legend>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={!!voice.sms} onChange={(e) => set({ sms: e.target.checked ? { text: '', when: usesKey('sms') ? 'key' : 'not_answered' } : null })}
            className="size-[18px] accent-[var(--primary)]" />
          Mandar um SMS pela mesma operadora
        </label>
        {voice.sms && chosen && !chosen.sms ? <Alert tone="warning">A operadora “{chosen.name}” não manda SMS. Escolha outra operadora ou desmarque o SMS.</Alert> : null}
        {voice.sms ? (
          <>
            <Select className="max-w-sm" label="Quando" value={voice.sms.when} onChange={(e) => set({ sms: { ...voice.sms!, when: e.target.value as ExtraWhen } })}>
              {Object.entries(EXTRA_WHEN).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
            <Textarea label="Texto do SMS *" rows={3} maxLength={612} value={voice.sms.text} error={fieldErr('voice.sms.text') ?? fieldErr('voice.sms')}
              hint={`${voice.sms.text.length} caracteres (${Math.max(1, Math.ceil(voice.sms.text.length / 153))} SMS)`}
              onChange={(e) => set({ sms: { ...voice.sms!, text: e.target.value } })} placeholder="{{primeiro_nome}}, tentamos falar com você. Responda pelo WhatsApp …" />
            <Vars onAdd={(v) => set({ sms: { ...voice.sms!, text: `${voice.sms!.text}{{${v}}}` } })} />
          </>
        ) : null}
      </fieldset>
    </div>
  );
}

function Vars({ onAdd }: { onAdd: (v: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
      <span>Inserir:</span>
      {CAMPAIGN_VARIABLES.map((v) => (
        <button key={v.key} type="button" onClick={() => onAdd(v.key)} title={v.label}
          className="rounded-full border border-line px-2 py-0.5 font-mono hover:bg-surface-2">{`{{${v.key}}}`}</button>
      ))}
    </div>
  );
}
