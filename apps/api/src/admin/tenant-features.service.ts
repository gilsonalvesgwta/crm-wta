import { promises as dns } from 'node:dns';
import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../access/actor.js';
import { tenantCtx } from '../access/decorators.js';
import { CONFIG, type Config } from '../config.js';
import { FilesService } from '../crm/files.service.js';
import { assertFeature, seatsInUse, tenantLimits } from '../crm/limits.js';
import { LIMIT_LABELS, allows } from '../domain/plans.js';
import { Problem } from '../http/problem.js';
import { Db, pgCode, type Q } from '../infra/db.js';
import { Storage } from '../infra/storage.js';
import { audit } from './audit.js';
import { brandingView } from './admin.service.js';

const BRAND_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const BRAND_MAX = 2 * 1024 * 1024;
const DOMAIN = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * O que cada empresa configura sobre si: logotipo e ícone, domínio próprio e a
 * consulta do próprio plano. Também as rotas públicas da tela de login.
 */
@Injectable()
export class TenantFeaturesService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(FilesService) private readonly files: FilesService,
    @Inject(Storage) private readonly storage: Storage,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  private get mainHost(): string {
    return new URL(this.cfg.APP_URL).hostname;
  }

  /** Para onde o domínio do cliente precisa apontar. */
  get domainTarget(): string {
    return this.cfg.CLIENT_DOMAIN_TARGET ?? this.mainHost;
  }

  // ---- Logotipo e ícone ---------------------------------------------------------

  async uploadBrandAsset(actor: Actor, kind: 'logo' | 'icon', name: string, data: Buffer) {
    if (data.length > BRAND_MAX) throw new Problem(413, 'A imagem passa de 2 MB.');
    return this.db.app(tenantCtx(actor), async (q) => {
      const type = await this.files.detectType(name, data);
      if (!BRAND_TYPES.has(type)) {
        throw Problem.badRequest('Formato não aceito.', [{ field: 'file', message: 'Envie PNG, JPG ou WebP.' }]);
      }
      const id = await this.files.storeIn(q, actor, { name, data, purpose: 'branding' });
      const col = kind === 'logo' ? 'logo_file_key' : 'logo_compact_file_key';
      const old = await q.query<{ key: string | null }>(`select ${col} as key from tenant_branding`);
      await q.query(
        `insert into tenant_branding (tenant_id, theme, ${col}, updated_by) values (app.tenant_id(), '{}', $1, $2)
         on conflict (tenant_id) do update set ${col} = excluded.${col}, updated_by = excluded.updated_by`, [id, actor.userId]);
      await this.dropFile(q, old.rows[0]?.key ?? null);
      await audit(q, actor, `branding.${kind}_updated`, 'tenant', actor.tenantId);
      return this.view(q);
    });
  }

  async removeBrandAsset(actor: Actor, kind: 'logo' | 'icon') {
    return this.db.app(tenantCtx(actor), async (q) => {
      const col = kind === 'logo' ? 'logo_file_key' : 'logo_compact_file_key';
      const old = await q.query<{ key: string | null }>(`select ${col} as key from tenant_branding`);
      await q.query(`update tenant_branding set ${col} = null`);
      await this.dropFile(q, old.rows[0]?.key ?? null);
      await audit(q, actor, `branding.${kind}_removed`, 'tenant', actor.tenantId);
      return this.view(q);
    });
  }

  private async dropFile(q: Q, id: string | null) {
    if (!id) return;
    const r = await q.query<{ storage_key: string }>("update files set deleted_at = now() where id = $1 and purpose = 'branding' returning storage_key", [id]);
    if (r.rows[0]) await this.storage.remove(r.rows[0].storage_key).catch(() => undefined);
  }

  private async view(q: Q) {
    const r = await q.query<{ tenant_id: string; product_name: string | null; theme: Record<string, never>; logo: string | null; icon: string | null }>(
      'select tenant_id, product_name, theme, logo_file_key as logo, logo_compact_file_key as icon from tenant_branding');
    return brandingView(r.rows[0] ?? null);
  }

  // ---- Rotas públicas (tela de login) -------------------------------------------------

  /** Marca da empresa dona do domínio acessado; null no endereço principal ou domínio desconhecido. */
  async publicBranding(host: string | null) {
    if (!host || host === this.mainHost) return null;
    const r = await this.db.auth((q) => q.query<{ tenant_id: string; tenant_name: string; product_name: string | null; theme: Record<string, never>; logo_file: string | null; icon_file: string | null }>(
      'select tenant_id, tenant_name, product_name, theme, logo_file, icon_file from app.public_branding($1)', [host]));
    const row = r.rows[0];
    if (!row) return null;
    return {
      tenantName: row.tenant_name,
      ...brandingView({ tenant_id: row.tenant_id, product_name: row.product_name ?? row.tenant_name, theme: row.theme, logo: row.logo_file, icon: row.icon_file }),
    };
  }

  /** Imagem da marca. Só o arquivo atual daquela empresa; o resto é 404. */
  async openBrandAsset(tenantId: string, kind: 'logo' | 'icon', fileId: string) {
    const row = await this.db.app({ tenantId, userId: null }, async (q) => {
      const col = kind === 'logo' ? 'logo_file_key' : 'logo_compact_file_key';
      const b = await q.query<{ key: string | null }>(`select ${col} as key from tenant_branding`);
      if (b.rows[0]?.key !== fileId) return null;
      return (await q.query<{ storage_key: string; content_type: string }>(
        "select storage_key, content_type from files where id = $1 and purpose = 'branding' and deleted_at is null", [fileId])).rows[0] ?? null;
    }).catch((err) => {
      if (pgCode(err) === '22P02') return null;
      throw err;
    });
    if (!row) throw Problem.notFound();
    const opened = await this.storage.open(row.storage_key);
    if (!opened) throw Problem.notFound();
    return { ...opened, contentType: row.content_type };
  }

  /** Resposta ao teste de rota do domínio: qual empresa o CRM reconhece neste endereço. */
  async domainEcho(host: string | null) {
    if (!host) return { tenantId: null };
    const r = await this.db.auth((q) => q.query<{ tenant_id: string }>('select tenant_id from app.auth_resolve_domain($1)', [host]));
    return { tenantId: r.rows[0]?.tenant_id ?? null };
  }

  // ---- Domínio próprio ---------------------------------------------------------------

  private async domainRow(q: Q) {
    const r = await q.query<{ domain: string; dns_ok: boolean; routing_ok: boolean; verified_at: Date | null; checked_at: Date | null; last_error: string | null }>(
      "select domain, dns_ok, routing_ok, verified_at, checked_at, last_error from tenant_domains where kind = 'custom'");
    return r.rows[0] ?? null;
  }

  private async domainView(q: Q) {
    const d = await this.domainRow(q);
    const limits = await tenantLimits(q);
    return {
      allowed: allows(limits, 'custom_domain'),
      target: this.domainTarget,
      domain: d?.domain ?? null,
      dnsOk: d?.dns_ok ?? false,
      routingOk: d?.routing_ok ?? false,
      verifiedAt: d?.verified_at ?? null,
      checkedAt: d?.checked_at ?? null,
      lastError: d?.last_error ?? null,
    };
  }

  async domain(actor: Actor) {
    return this.db.app(tenantCtx(actor), (q) => this.domainView(q));
  }

  async setDomain(actor: Actor, raw: string) {
    const domain = raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');
    if (!DOMAIN.test(domain)) throw Problem.badRequest('Domínio inválido.', [{ field: 'domain', message: 'Use só o endereço, como crm.suaempresa.com.br.' }]);
    if (domain === this.mainHost || domain.endsWith(`.${this.mainHost}`) || domain === this.domainTarget) {
      throw Problem.badRequest('Domínio reservado.', [{ field: 'domain', message: 'Use um domínio da sua empresa.' }]);
    }
    return this.db.app(tenantCtx(actor), async (q) => {
      await assertFeature(q, 'custom_domain');
      await q.query("delete from tenant_domains where kind = 'custom'");
      try {
        await q.query("insert into tenant_domains (tenant_id, domain, kind) values (app.tenant_id(), $1, 'custom')", [domain]);
      } catch (err) {
        if (pgCode(err) === '23505') throw Problem.conflict('Esse domínio já está em uso por outra empresa.');
        throw err;
      }
      await audit(q, actor, 'domain.set', 'tenant', actor.tenantId, { domain });
      return this.domainView(q);
    });
  }

  async removeDomain(actor: Actor) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const d = await this.domainRow(q);
      await q.query("delete from tenant_domains where kind = 'custom'");
      if (d) await audit(q, actor, 'domain.removed', 'tenant', actor.tenantId, { domain: d.domain });
      return this.domainView(q);
    });
  }

  /**
   * Confere o domínio em duas etapas: o DNS aponta para o CRM (CNAME para o
   * alvo, ou os mesmos IPs) e o endereço chega de fato a este CRM (rota no
   * Traefik e certificado). A marca na tela de login vale a partir do DNS.
   */
  async checkDomain(actor: Actor) {
    const current = await this.db.app(tenantCtx(actor), (q) => this.domainRow(q));
    if (!current) throw Problem.notFound('Cadastre o domínio primeiro.');
    const domain = current.domain;
    let dnsOk = false;
    let error: string | null = null;
    try {
      const cname = await dns.resolveCname(domain).catch(() => [] as string[]);
      if (cname.some((c) => c.toLowerCase().replace(/\.$/, '') === this.domainTarget)) dnsOk = true;
      else {
        const [mine, target] = await Promise.all([dns.resolve4(domain).catch(() => [] as string[]), dns.resolve4(this.domainTarget).catch(() => [] as string[])]);
        dnsOk = mine.length > 0 && mine.some((ip) => target.includes(ip));
        if (!dnsOk) error = mine.length ? `O domínio aponta para ${mine.join(', ')}, não para o CRM.` : 'O domínio ainda não existe no DNS.';
      }
    } catch (err) {
      error = `Não foi possível consultar o DNS: ${String(err).slice(0, 200)}`;
    }
    let routingOk = false;
    try {
      const r = await fetch(`https://${domain}/api/v1/public/domain-check`, { signal: AbortSignal.timeout(6000), redirect: 'manual' });
      const body = (await r.json().catch(() => null)) as { tenantId?: string | null } | null;
      routingOk = r.ok && body?.tenantId === actor.tenantId;
      if (dnsOk && !routingOk) error = 'O DNS está certo, mas o endereço ainda não chega ao CRM com certificado. Veja o passo 2 das instruções.';
    } catch {
      // Ponto que muda primeiro (DNS ou rota) define a mensagem; a rota costuma ser a última.
      if (dnsOk) error = 'O DNS está certo, mas o endereço ainda não chega ao CRM com certificado. Veja o passo 2 das instruções.';
    }
    // Rota funcionando prova o DNS, mesmo atrás de um proxy (Cloudflare) que esconde o IP.
    if (routingOk) {
      dnsOk = true;
      error = null;
    }
    return this.db.app(tenantCtx(actor), async (q) => {
      await q.query(
        `update tenant_domains set dns_ok = $1, routing_ok = $2, checked_at = now(), last_error = $3,
                verified_at = case when $1 then coalesce(verified_at, now()) else null end
          where kind = 'custom'`, [dnsOk, routingOk, error]);
      return this.domainView(q);
    });
  }

  // ---- Plano da empresa ------------------------------------------------------------

  async subscription(actor: Actor) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const s = await q.query<{ plan_name: string | null; status: string; current_period_end: Date | null; billing_period: string | null }>(
        `select p.name as plan_name, s.status, s.current_period_end, p.billing_period
           from tenant_subscriptions s left join plans p on p.id = s.plan_id`);
      const limits = await tenantLimits(q);
      const usage = { max_users: await seatsInUse(q) };
      const row = s.rows[0];
      return {
        plan: row?.plan_name ?? null,
        status: row?.status ?? null,
        currentPeriodEnd: row?.current_period_end ?? null,
        limits: limits === null ? null : Object.entries(LIMIT_LABELS).map(([key, label]) => ({
          key, label, value: (limits as Record<string, unknown>)[key] ?? null, used: (usage as Record<string, number>)[key] ?? null,
        })),
      };
    });
  }
}
