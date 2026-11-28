// Operadoras de voz: formato do cadastro, validado aqui.
import { z } from 'zod';

export const VOICE_PROVIDERS = ['twilio', 'plivo', 'telnyx', 'zenvia', 'infobip', 'sip', 'http', 'velip'] as const;

const fields = z.record(z.string().regex(/^[a-zA-Z]{2,40}$/), z.string().trim().max(500)).default({});

export const voiceProviderBody = z.object({
  name: z.string().trim().min(1, { message: 'Dê um nome para a operadora.' }).max(80),
  provider: z.enum(VOICE_PROVIDERS, { message: 'Escolha a operadora.' }),
  config: fields,
  /** Segredos (token, senha, chave). Ausente: mantém os atuais. */
  secret: z.record(z.string().regex(/^[a-zA-Z]{2,40}$/), z.string().trim().max(2000)).nullable().optional(),
});
export type VoiceProviderInput = z.infer<typeof voiceProviderBody>;

export const voiceTestBody = z.object({
  /** Telefone que recebe a ligação de teste; vazio: só confere as credenciais. */
  to: z.string().trim().max(30).nullable().optional().transform((v) => v || null),
  audioFileId: z.string().uuid().nullable().optional(),
});
