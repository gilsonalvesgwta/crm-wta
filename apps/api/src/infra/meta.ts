import { Inject, Injectable, Logger } from '@nestjs/common';
import { CONFIG, type Config } from '../config.js';

type Json = Record<string, unknown>;
export type MetaHost = 'facebook' | 'instagram';

/** Avisos do Instagram que os fluxos usam. */
export const IG_FIELDS = ['messages', 'messaging_postbacks', 'message_reactions', 'comments', 'live_comments', 'mentions'] as const;

/** Erro da API da Meta, com uma mensagem que dá para mostrar. */
export class MetaError extends Error {
  constructor(message: string, readonly code: number | null = null, readonly httpStatus = 0) {
    super(message);
  }
}

const KNOWN: Record<number, string> = {
  190: 'O token de acesso é inválido ou venceu. Gere um token permanente (usuário do sistema) e salve de novo.',
  10: 'O token não tem permissão para esta ação. Confira as permissões do app na Meta.',
  200: 'O token não tem permissão para esta ação. Confira as permissões do app na Meta.',
  100: 'A Meta recusou os dados enviados.',
  131047: 'Passaram mais de 24 horas da última mensagem do cliente: use um modelo aprovado.',
  131026: 'O número não pode receber mensagens do WhatsApp.',
  132001: 'O modelo não existe ou não foi aprovado neste idioma.',
  368: 'A Meta bloqueou temporariamente esta conta por violação de política.',
  80007: 'Limite de envios da Meta atingido. Tente de novo em alguns minutos.',
  130429: 'Limite de envios da Meta atingido. Tente de novo em alguns minutos.',
};

/** Domínios de onde a Meta serve a mídia das mensagens recebidas. */
const MEDIA_HOSTS = /(^|\.)(fbsbx\.com|facebook\.com|fbcdn\.net|cdninstagram\.com|whatsapp\.net)$/;

/**
 * Cliente da Graph API (WhatsApp Cloud API e Instagram). Cada empresa usa o
 * próprio token; nada é global.
 */
@Injectable()
export class Meta {
  private readonly log = new Logger('Meta');
  constructor(@Inject(CONFIG) private readonly cfg: Config) {}

  private base(host: MetaHost): string {
    return `${host === 'instagram' ? this.cfg.META_INSTAGRAM_URL : this.cfg.META_GRAPH_URL}/${this.cfg.META_GRAPH_VERSION}`;
  }

  async call<T = Json>(method: string, host: MetaHost, path: string, token: string, body?: unknown, timeoutMs = 20_000): Promise<T> {
    if (!/^[0-9A-Za-z_.-]+(\/[a-z_]+)?(\?[^\s#]*)?$/.test(path)) throw new Error(`caminho da Meta fora do permitido: ${path}`);
    let res: Response;
    try {
      const form = body instanceof FormData;
      res = await fetch(`${this.base(host)}/${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, ...(body !== undefined && !form ? { 'content-type': 'application/json' } : {}) },
        body: body === undefined ? undefined : form ? body : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new MetaError((err as Error).name === 'TimeoutError' ? 'A Meta não respondeu a tempo.' : 'Não foi possível falar com a Meta.');
    }
    const text = await res.text();
    let data: Json = {};
    try { data = text ? JSON.parse(text) as Json : {}; } catch { /* resposta sem JSON */ }
    if (!res.ok) {
      const e = (data.error ?? {}) as { message?: string; code?: number; error_subcode?: number; error_user_msg?: string; error_data?: { details?: string } };
      const code = e.code ?? null;
      const known = code !== null ? KNOWN[code] : undefined;
      const detail = e.error_user_msg ?? e.error_data?.details ?? e.message ?? `erro ${res.status}`;
      throw new MetaError(known && code !== 100 ? known : `${known ?? 'A Meta recusou'}: ${detail}`.slice(0, 900), code, res.status);
    }
    return data as T;
  }

  // ---- Meta Ads (gasto das contas de anúncios) ---------------------------------------

  /** Dados da conta de anúncios (id numérico, sem "act_"). Precisa de ads_read. */
  adAccount(accountId: string, token: string) {
    return this.call<{ id: string; name?: string; currency?: string; account_status?: number }>(
      'GET', 'facebook', `act_${accountId}?fields=name,currency,account_status`, token);
  }

  /** Gasto por dia entre duas datas (AAAA-MM-DD), em unidades da moeda da conta. Dias sem veiculação não vêm. */
  async adSpendByDay(accountId: string, token: string, since: string, until: string): Promise<{ day: string; spend: number }[]> {
    const out: { day: string; spend: number }[] = [];
    let after: string | null = null;
    for (let page = 0; page < 20; page++) {
      const range = encodeURIComponent(JSON.stringify({ since, until }));
      const r: { data?: { spend?: string; date_start?: string }[]; paging?: { cursors?: { after?: string }; next?: string } } = await this.call(
        'GET', 'facebook', `act_${accountId}/insights?fields=spend&level=account&time_increment=1&time_range=${range}&limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`, token, undefined, 60_000);
      for (const d of r.data ?? []) {
        const spend = Number(d.spend ?? 0);
        if (d.date_start && /^\d{4}-\d{2}-\d{2}$/.test(d.date_start) && Number.isFinite(spend)) out.push({ day: d.date_start, spend });
      }
      after = r.paging?.next ? r.paging.cursors?.after ?? null : null;
      if (!after) break;
    }
    return out;
  }

  // ---- WhatsApp (Cloud API) ---------------------------------------------------------

  phoneInfo(phoneNumberId: string, token: string) {
    return this.call<{ id: string; display_phone_number?: string; verified_name?: string; quality_rating?: string }>(
      'GET', 'facebook', `${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`, token);
  }

  async sendWhatsapp(phoneNumberId: string, token: string, payload: Json): Promise<string> {
    const r = await this.call<{ messages?: { id: string }[] }>('POST', 'facebook', `${phoneNumberId}/messages`, token,
      { messaging_product: 'whatsapp', recipient_type: 'individual', ...payload });
    const id = r.messages?.[0]?.id;
    if (!id) throw new MetaError('A Meta não devolveu o identificador da mensagem.');
    return id;
  }

  async uploadMedia(phoneNumberId: string, token: string, file: { data: Buffer; type: string; name: string }): Promise<string> {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', file.type);
    form.append('file', new Blob([new Uint8Array(file.data)], { type: file.type }), file.name);
    const r = await this.call<{ id?: string }>('POST', 'facebook', `${phoneNumberId}/media`, token, form, 60_000);
    if (!r.id) throw new MetaError('A Meta não aceitou o arquivo.');
    return r.id;
  }

  /** Baixa a mídia de uma mensagem recebida (só dos domínios da Meta ou do servidor configurado). */
  async downloadMedia(mediaId: string, token: string, host: MetaHost, maxBytes: number): Promise<{ data: Buffer; mimetype: string | null } | null> {
    const info = await this.call<{ url?: string; mime_type?: string }>('GET', host, mediaId, token);
    if (!info.url) return null;
    return this.fetchMedia(info.url, token, maxBytes, info.mime_type ?? null);
  }

  async fetchMedia(url: string, token: string | null, maxBytes: number, mimetype: string | null = null): Promise<{ data: Buffer; mimetype: string | null } | null> {
    let u: URL;
    try { u = new URL(url); } catch { return null; }
    const own = new URL(this.cfg.META_GRAPH_URL).host === u.host || new URL(this.cfg.META_INSTAGRAM_URL).host === u.host;
    if (!own && (u.protocol !== 'https:' || !MEDIA_HOSTS.test(u.hostname))) return null;
    const res = await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; CRM-WTA/1.0)', ...(token ? { authorization: `Bearer ${token}` } : {}) }, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) {
      this.log.warn(`mídia da Meta não baixada: ${u.hostname} respondeu ${res.status}`);
      return null;
    }
    const data = Buffer.from(await res.arrayBuffer());
    if (!data.length || data.length > maxBytes) {
      this.log.warn(`mídia da Meta não guardada: ${data.length} bytes`);
      return null;
    }
    return { data, mimetype: mimetype ?? res.headers.get('content-type') };
  }

  listTemplates(wabaId: string, token: string) {
    return this.call<{ data?: { id: string; name: string; status: string; language: string; category: string; rejected_reason?: string; components?: Json[] }[] }>(
      'GET', 'facebook', `${wabaId}/message_templates?fields=id,name,status,language,category,rejected_reason,components&limit=250`, token);
  }

  /** Id do app dono do token (para o envio do arquivo de exemplo do modelo). */
  async appId(token: string): Promise<string> {
    const r = await this.call<{ id?: string }>('GET', 'facebook', 'app', token);
    if (!r.id || !/^[0-9]{3,30}$/.test(r.id)) throw new MetaError('A Meta não devolveu o id do app.');
    return r.id;
  }

  /**
   * Envio do arquivo de exemplo do cabeçalho (API de envio retomável da Meta):
   * abre a sessão no app e manda o arquivo; devolve o identificador ("handle")
   * usado em example.header_handle.
   */
  async uploadTemplateMedia(appId: string, token: string, file: { data: Buffer; type: string; name: string }): Promise<string> {
    const q = new URLSearchParams({ file_name: file.name.slice(0, 200), file_length: String(file.data.length), file_type: file.type });
    const session = await this.call<{ id?: string }>('POST', 'facebook', `${appId}/uploads?${q}`, token, undefined, 30_000);
    const id = session.id ?? '';
    if (!/^upload:[A-Za-z0-9+/=_:-]+(\?sig=[A-Za-z0-9_=-]+)?$/.test(id)) throw new MetaError('A Meta não abriu o envio do arquivo.');
    let res: Response;
    try {
      res = await fetch(`${this.base('facebook')}/${id}`, {
        method: 'POST', headers: { authorization: `OAuth ${token}`, file_offset: '0', 'content-type': file.type },
        body: new Uint8Array(file.data), signal: AbortSignal.timeout(120_000),
      });
    } catch {
      throw new MetaError('Não foi possível enviar o arquivo para a Meta.');
    }
    const data = await res.json().catch(() => ({})) as { h?: string; error?: { message?: string; code?: number } };
    if (!res.ok || !data.h) throw new MetaError(`A Meta recusou o arquivo: ${data.error?.message ?? `erro ${res.status}`}`.slice(0, 900), data.error?.code ?? null, res.status);
    return data.h;
  }

  createTemplate(wabaId: string, token: string, body: Json) {
    return this.call<{ id?: string; status?: string; category?: string }>('POST', 'facebook', `${wabaId}/message_templates`, token, body);
  }

  deleteTemplate(wabaId: string, token: string, name: string, metaId: string | null) {
    const q = `name=${encodeURIComponent(name)}${metaId ? `&hsm_id=${metaId}` : ''}`;
    return this.call('DELETE', 'facebook', `${wabaId}/message_templates?${q}`, token);
  }

  /** Liga o app à conta do WhatsApp Business: sem isso, os avisos das mensagens não chegam. */
  async subscribeWaba(wabaId: string, token: string): Promise<void> {
    await this.call('POST', 'facebook', `${wabaId}/subscribed_apps`, token, {});
  }

  /** Registra o número na Cloud API com o PIN da verificação em duas etapas (6 dígitos). */
  async registerPhone(phoneNumberId: string, token: string, pin: string): Promise<void> {
    await this.call('POST', 'facebook', `${phoneNumberId}/register`, token, { messaging_product: 'whatsapp', pin });
  }

  // ---- Instagram ----------------------------------------------------------------------

  /**
   * Ativa os avisos desta conta do Instagram para o app: mensagens, cliques em
   * botão, reações, comentários (posts, reels e live) e menções.
   */
  async igSubscribe(token: string, host: MetaHost): Promise<void> {
    await this.call('POST', host, `me/subscribed_apps?subscribed_fields=${IG_FIELDS.join(',')}`, token, {});
  }

  /** Avisos que a conta tem ativos para o app. */
  async igSubscriptions(token: string, host: MetaHost): Promise<string[]> {
    const r = await this.call<{ data?: { subscribed_fields?: string[] }[] }>('GET', host, 'me/subscribed_apps', token);
    return [...new Set((r.data ?? []).flatMap((d) => d.subscribed_fields ?? []))];
  }

  /** Responde publicamente a um comentário. */
  async igReplyComment(commentId: string, token: string, host: MetaHost, message: string): Promise<string> {
    const r = await this.call<{ id?: string }>('POST', host, `${commentId}/replies`, token, { message });
    return r.id ?? '';
  }

  /**
   * Manda uma mensagem no direct: para a pessoa (id) ou como resposta privada a
   * um comentário (comment_id, uma vez por comentário, até 7 dias depois).
   */
  async igSendMessage(igUserId: string, token: string, host: MetaHost, recipient: { id: string } | { comment_id: string }, message: Json): Promise<{ messageId: string; recipientId: string | null }> {
    const r = await this.call<{ message_id?: string; recipient_id?: string }>('POST', host, `${igUserId}/messages`, token, { recipient, message });
    if (!r.message_id) throw new MetaError('A Meta não devolveu o identificador da mensagem.');
    return { messageId: r.message_id, recipientId: r.recipient_id ?? null };
  }

  /** Publicações recentes da conta (para escolher em quais o fluxo funciona). */
  async igMedia(token: string, host: MetaHost): Promise<{ id: string; caption?: string; media_type?: string; media_product_type?: string; media_url?: string; thumbnail_url?: string; permalink?: string; timestamp?: string }[]> {
    const r = await this.call<{ data?: [] }>('GET', host, 'me/media?fields=id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp&limit=50', token);
    return r.data ?? [];
  }

  /** A pessoa segue a conta? (só para quem já conversou com a conta). */
  async igFollows(igsid: string, token: string, host: MetaHost): Promise<boolean | null> {
    const r = await this.call<{ is_user_follow_business?: boolean }>('GET', host, `${igsid}?fields=is_user_follow_business`, token, undefined, 8000);
    return typeof r.is_user_follow_business === 'boolean' ? r.is_user_follow_business : null;
  }

  /** Renova o token de longa duração do Instagram (vale 60 dias; precisa ter mais de 24 h). */
  async igRefresh(token: string): Promise<{ token: string; expiresIn: number }> {
    let res: Response;
    try {
      res = await fetch(`${this.cfg.META_INSTAGRAM_URL}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`,
        { signal: AbortSignal.timeout(20_000) });
    } catch {
      throw new MetaError('Não foi possível falar com o Instagram.');
    }
    const data = await res.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error?: { message?: string; code?: number } };
    if (!res.ok || !data.access_token) {
      const code = data.error?.code ?? null;
      throw new MetaError(code === 190 ? 'O token do Instagram venceu ou foi revogado: gere um novo e salve na conta.' : `O Instagram não renovou o token: ${data.error?.message ?? res.status}`, code, res.status);
    }
    return { token: data.access_token, expiresIn: data.expires_in ?? 0 };
  }


  igInfo(igUserId: string, token: string, host: MetaHost) {
    return this.call<{ id: string; username?: string; name?: string }>('GET', host, `${igUserId}?fields=id,username,name`, token);
  }

  igProfile(igsid: string, token: string, host: MetaHost) {
    return this.call<{ name?: string; username?: string }>('GET', host, `${igsid}?fields=name,username`, token, undefined, 8000);
  }

  async igSend(igUserId: string, token: string, host: MetaHost, recipient: string, text: string): Promise<string> {
    const r = await this.call<{ message_id?: string }>('POST', host, `${igUserId}/messages`, token, { recipient: { id: recipient }, message: { text } });
    if (!r.message_id) throw new MetaError('A Meta não devolveu o identificador da mensagem.');
    return r.message_id;
  }
}
