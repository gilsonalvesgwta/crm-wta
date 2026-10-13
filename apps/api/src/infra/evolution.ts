import { Inject, Injectable } from '@nestjs/common';
import { CONFIG, type Config } from '../config.js';
import { Problem } from '../http/problem.js';

/** Eventos que as instâncias criadas pelo CRM mandam para ele. */
export const EVOLUTION_EVENTS = ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'SEND_MESSAGE', 'CONNECTION_UPDATE'];

export class EvolutionError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

type Json = Record<string, unknown>;

function msgOf(body: unknown): string | null {
  const b = body as { response?: { message?: unknown }; message?: unknown; error?: unknown } | null;
  const m = b?.response?.message ?? b?.message ?? b?.error;
  if (Array.isArray(m)) {
    // Número sem WhatsApp: [{ exists: false, number: "..." }].
    if (m.some((x) => typeof x === 'object' && x !== null && (x as { exists?: unknown }).exists === false)) return 'Este número não tem WhatsApp.';
    return m.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('; ').slice(0, 300);
  }
  return typeof m === 'string' ? m.slice(0, 300) : null;
}

/**
 * Cliente da Evolution API v2, com a chave global. O CRM só cria e mexe em
 * instâncias com o prefixo "crmwta-"; as demais instâncias do servidor não são
 * tocadas.
 */
@Injectable()
export class Evolution {
  constructor(@Inject(CONFIG) private readonly cfg: Config) {}

  get configured(): boolean {
    return !!this.cfg.EVOLUTION_URL && !!this.cfg.EVOLUTION_API_KEY;
  }

  assertConfigured(): void {
    if (!this.configured) {
      throw new Problem(409, 'O WhatsApp ainda não está disponível: falta configurar a Evolution API na instalação (EVOLUTION_URL e EVOLUTION_CHAVE).', 'evolution-not-configured');
    }
  }

  private async call<T = Json>(method: string, path: string, body?: unknown, timeoutMs = 20_000): Promise<T> {
    this.assertConfigured();
    if (!/^\/[a-zA-Z/]+\/crmwta-[a-z0-9-]+(\?.*)?$|^\/instance\/(create|fetchInstances)(\?.*)?$/.test(path)) {
      throw new Error(`caminho da Evolution fora do permitido: ${path}`);
    }
    let res: Response;
    try {
      res = await fetch(`${this.cfg.EVOLUTION_URL}${path}`, {
        method,
        headers: { apikey: this.cfg.EVOLUTION_API_KEY!, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new EvolutionError(0, `A Evolution API não respondeu (${(err as Error).name === 'TimeoutError' ? 'tempo esgotado' : 'sem conexão'}).`);
    }
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) throw new EvolutionError(res.status, msgOf(data) ?? `A Evolution API respondeu ${res.status}.`);
    return data as T;
  }

  async createInstance(name: string, webhookUrl: string): Promise<{ qr: string | null; pairingCode: string | null }> {
    const r = await this.call<Json>('POST', '/instance/create', {
      instanceName: name,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
      groupsIgnore: true,
      webhook: { enabled: true, url: webhookUrl, byEvents: false, base64: true, events: EVOLUTION_EVENTS },
    });
    const qr = (r.qrcode ?? {}) as Json;
    return { qr: typeof qr.base64 === 'string' ? qr.base64 : null, pairingCode: typeof qr.pairingCode === 'string' ? qr.pairingCode : null };
  }

  /** Garante o webhook da instância do CRM (reconexão, troca de endereço). */
  async setWebhook(name: string, webhookUrl: string): Promise<void> {
    await this.call('POST', `/webhook/set/${name}`, {
      webhook: { enabled: true, url: webhookUrl, byEvents: false, base64: true, events: EVOLUTION_EVENTS },
    });
  }

  /** QR code novo para ler no celular (ou o estado, se já conectado). */
  async connect(name: string): Promise<{ qr: string | null; pairingCode: string | null }> {
    const r = await this.call<Json>('GET', `/instance/connect/${name}`);
    return { qr: typeof r.base64 === 'string' ? r.base64 : null, pairingCode: typeof r.pairingCode === 'string' ? r.pairingCode : null };
  }

  async state(name: string): Promise<string> {
    const r = await this.call<Json>('GET', `/instance/connectionState/${name}`);
    const inst = (r.instance ?? r) as Json;
    return typeof inst.state === 'string' ? inst.state : 'unknown';
  }

  /** Número conectado à instância (JID do dono), quando houver. */
  async owner(name: string): Promise<string | null> {
    const r = await this.call<unknown>('GET', `/instance/fetchInstances?instanceName=${encodeURIComponent(name)}`);
    const list = Array.isArray(r) ? r : [r];
    for (const it of list as Json[]) {
      const inner = (it.instance ?? it) as Json;
      const jid = inner.ownerJid ?? inner.owner;
      if (typeof jid === 'string') return jid;
    }
    return null;
  }

  async logout(name: string): Promise<void> {
    await this.call('DELETE', `/instance/logout/${name}`);
  }

  async remove(name: string): Promise<void> {
    await this.call('DELETE', `/instance/delete/${name}`);
  }

  async sendText(name: string, number: string, text: string): Promise<string | null> {
    const r = await this.call<Json>('POST', `/message/sendText/${name}`, { number, text }, 30_000);
    return idOf(r);
  }

  async sendMedia(name: string, number: string, m: { mediatype: 'image' | 'video' | 'audio' | 'document'; mimetype: string; base64: string; fileName: string; caption?: string }): Promise<string | null> {
    const r = await this.call<Json>('POST', `/message/sendMedia/${name}`, {
      number, mediatype: m.mediatype, mimetype: m.mimetype, media: m.base64, fileName: m.fileName, caption: m.caption ?? '',
    }, 60_000);
    return idOf(r);
  }
}

function idOf(r: Json): string | null {
  const key = r.key as Json | undefined;
  return typeof key?.id === 'string' ? key.id : null;
}
