// Operadoras de voz (campanhas de ligação): campos de cada uma e textos de ajuda.

export type VoiceProviderKind = 'twilio' | 'plivo' | 'telnyx' | 'zenvia' | 'infobip' | 'sip' | 'http' | 'velip';

export type VoiceProvider = {
  id: string; name: string; provider: VoiceProviderKind; config: Record<string, string>; secretHint: string | null;
  status: 'untested' | 'ok' | 'error'; lastError: string | null; testedAt: string | null; sms: boolean; callbackUrl: string;
  /** Endereço único da conta (ex.: "URL atendimento" da Velip). */
  accountUrl?: string;
};

export type VoiceAudio = { id: string; name: string; contentType: string; size: number; createdAt: string };

type FieldDef = { key: string; label: string; placeholder?: string; hint?: string; required?: boolean; secret?: boolean };

export const PROVIDERS: Record<VoiceProviderKind, { label: string; about: string; site?: string; fields: FieldDef[] }> = {
  velip: {
    label: 'Velip',
    about: 'Empresa brasileira de torpedo de voz e SMS, com crédito pré-pago em reais. Além do áudio gravado: voz sintética (texto falado), teclas, transferência para atendente ou fila, gravação, novas tentativas e horário permitido por DDD.',
    site: 'https://vox.velip.com.br',
    fields: [
      { key: 'tsid', label: 'Token da API (tsid)', secret: true, required: true, hint: 'No painel da Velip: Integrações › Tokens API › Gerar token (não use o token do MCP Server).' },
      { key: 'callerId', label: 'Bina (opcional)', placeholder: '11 4000-0000', hint: 'Só vale se a sua conta Velip tiver bina fixa ou rota própria.' },
      { key: 'baseUrl', label: 'Endereço da API', placeholder: 'https://vox.velip.com.br', hint: 'Deixe em branco, salvo se a Velip indicar outro.' },
    ],
  },
  twilio: {
    label: 'Twilio',
    about: 'Global, cadastro na hora pelo site e pagamento em dólar por minuto. Precisa de um número de telefone comprado na Twilio (ou verificado) para aparecer como bina.',
    site: 'https://console.twilio.com',
    fields: [
      { key: 'accountSid', label: 'Account SID', placeholder: 'AC…', required: true },
      { key: 'authToken', label: 'Auth Token', secret: true, required: true },
      { key: 'from', label: 'Número que liga (bina)', placeholder: '+55 11 4000-0000', required: true, hint: 'Um número da sua conta Twilio.' },
    ],
  },
  plivo: {
    label: 'Plivo',
    about: 'Parecida com a Twilio, costuma sair mais barata para fixo. Cadastro pelo site.',
    site: 'https://console.plivo.com',
    fields: [
      { key: 'authId', label: 'Auth ID', required: true },
      { key: 'authToken', label: 'Auth Token', secret: true, required: true },
      { key: 'from', label: 'Número que liga (bina)', placeholder: '+55 11 4000-0000', required: true },
    ],
  },
  telnyx: {
    label: 'Telnyx',
    about: 'Operadora com rede própria e minuto barato. Crie um aplicativo TeXML no portal e informe o ID dele.',
    site: 'https://portal.telnyx.com',
    fields: [
      { key: 'apiKey', label: 'API Key', secret: true, required: true, placeholder: 'KEY…' },
      { key: 'applicationId', label: 'ID do aplicativo TeXML', required: true },
      { key: 'from', label: 'Número que liga (bina)', placeholder: '+55 11 4000-0000', required: true },
      { key: 'messagingProfileId', label: 'Perfil de mensagens (SMS)', hint: 'Opcional. Só para mandar SMS pela Telnyx.' },
    ],
  },
  zenvia: {
    label: 'Zenvia Voz (TotalVoice)',
    about: 'Empresa brasileira, cobra em reais e tem torpedo de voz e SMS. O token fica no painel da Zenvia Voz.',
    site: 'https://www.zenvia.com',
    fields: [
      { key: 'accessToken', label: 'Access-Token', secret: true, required: true },
      { key: 'from', label: 'Bina (opcional)', placeholder: '11 4000-0000', hint: 'Número que aparece para quem recebe, se a sua conta permitir.' },
      { key: 'apiBase', label: 'Endereço da API', placeholder: 'https://api2.totalvoice.com.br', hint: 'Deixe em branco, salvo se a Zenvia indicar outro.' },
    ],
  },
  infobip: {
    label: 'Infobip',
    about: 'Plataforma global com escritório no Brasil (voz, SMS e WhatsApp). Contratação com o comercial deles.',
    site: 'https://www.infobip.com',
    fields: [
      { key: 'baseUrl', label: 'Endereço da sua conta', placeholder: 'xxxxx.api.infobip.com', required: true },
      { key: 'apiKey', label: 'API Key', secret: true, required: true },
      { key: 'from', label: 'Número que liga (bina)', placeholder: '5511400000000', required: true },
    ],
  },
  sip: {
    label: 'Central própria (SIP / Asterisk)',
    about: 'Usa a sua central Asterisk (ou Issabel/FreePBX) com o tronco SIP da operadora que você já tem. O custo é o do seu tronco.',
    fields: [
      { key: 'ariUrl', label: 'Endereço da ARI', placeholder: 'https://pbx.suaempresa.com.br:8089', required: true },
      { key: 'ariUser', label: 'Usuário da ARI', required: true },
      { key: 'ariPassword', label: 'Senha da ARI', secret: true, required: true },
      { key: 'endpoint', label: 'Como discar', placeholder: 'PJSIP/{nacional}@minha-operadora', required: true,
        hint: 'Use {nacional} (DDD + número), {numero} (com 55) ou {e164} (+55…).' },
      { key: 'context', label: 'Contexto do roteiro', placeholder: 'crm-voz' },
      { key: 'callerId', label: 'Bina', placeholder: '1140000000' },
    ],
  },
  http: {
    label: 'Outra operadora (API)',
    about: 'Para qualquer empresa com API de ligação (ligueLead, Orbsofty e outras): o CRM manda o pedido e a operadora avisa o resultado no endereço de retorno.',
    fields: [
      { key: 'callUrl', label: 'Endereço para ligar', placeholder: 'https://api.operadora.com.br/ligar', required: true },
      { key: 'authorization', label: 'Cabeçalho Authorization', secret: true, placeholder: 'Bearer …', hint: 'Opcional.' },
      { key: 'smsUrl', label: 'Endereço para SMS', placeholder: 'https://api.operadora.com.br/sms', hint: 'Opcional.' },
      { key: 'from', label: 'Bina', placeholder: '+55 11 4000-0000' },
    ],
  },
};

export const PROVIDER_STATUS: Record<VoiceProvider['status'], { label: string; tone: 'ok' | 'warn' | 'bad' }> = {
  untested: { label: 'Falta testar', tone: 'warn' },
  ok: { label: 'Testada', tone: 'ok' },
  error: { label: 'Com erro', tone: 'bad' },
};

/** Roteiro do Asterisk que toca o áudio, lê a tecla e avisa o CRM. */
export const ASTERISK_DIALPLAN = `; /etc/asterisk/extensions.conf  (precisa de func_curl e do curl instalado)
[crm-voz]
exten => s,1,Answer()
 same => n,Set(ARQ=/tmp/crm-\${UNIQUEID})
 same => n,System(curl -sf -o \${ARQ}.wav "\${CRM_AUDIO}")
 same => n,GotoIf($["\${CRM_DIGITS}" = "1"]?tecla)
 same => n,Playback(\${ARQ})
 same => n,Hangup()
 same => n(tecla),Read(TECLA,\${ARQ},1,,1,6)
 same => n,GotoIf($["\${TECLA}" = ""]?fim)
 same => n,Set(R=\${CURL(\${CRM_CB}?evento=tecla&tecla=\${TECLA})})
 same => n(fim),Hangup()
exten => h,1,Set(R=\${CURL(\${CRM_CB}?evento=fim&status=\${IF($[\${CDR(billsec)} > 0]?ANSWER:NOANSWER)}&duracao=\${CDR(billsec)})})
 same => n,System(rm -f \${ARQ}.wav)`;

/** Corpo que a "Outra operadora" recebe e como avisar o resultado. */
export const HTTP_CONTRACT = `POST <endereço para ligar>
{ "to": "+5511999998888", "from": "…", "audioUrl": "https://…/audio.mp3", "audioWavUrl": "https://…/audio.wav",
  "digits": true, "ringSeconds": 30, "reference": "…", "callbackUrl": "https://…/http" }

Resultado: POST <callbackUrl>
{ "status": "answered" | "no_answer" | "busy" | "failed" | "machine", "digits": "1", "duration": 12 }`;
