import { Inject, Injectable, Logger } from '@nestjs/common';
import { CONFIG, type Config } from '../config.js';
import { Db } from '../infra/db.js';
import { MessagesService } from './messages.service.js';

/** Quantos negócios aparecem por nome no resumo; o resto vira "e mais N". */
const TOP = 10;
/** Pausa entre um WhatsApp e outro, para não disparar tudo de uma vez. */
const GAP_MS = 1500;

type Row = {
  deal_id: string; title: string; pipeline: string; stage: string; idle: number;
  account_id: string | null; wa: boolean; in_app: boolean;
  member_id: string; phone: string | null; who: string | null;
};
type Item = { id: string; title: string; pipeline: string; stage: string; idle: number };

/**
 * Negócio parado: avisa, de tantos em tantos dias, conforme o funil, quem
 * cadastrou o negócio, o responsável e/ou pessoas fixas, por WhatsApp e/ou no
 * próprio CRM (o sininho). O banco escolhe e marca os negócios
 * (app.claim_stale_deals), então o mesmo aviso não sai duas vezes; cada pessoa
 * recebe uma mensagem só, com o resumo de todos os seus negócios parados.
 */
@Injectable()
export class StaleDealsService {
  private readonly log = new Logger('NegocioParado');
  /** Pausa entre envios (zero nos testes). */
  gapMs: number;

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(MessagesService) private readonly messages: MessagesService,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {
    this.gapMs = cfg.NODE_ENV === 'test' ? 0 : GAP_MS;
  }

  async dispatch(): Promise<number> {
    const due = await this.db.dispatch(async (q) =>
      (await q.query<{ tenant_id: string; deal_id: string }>('select tenant_id, deal_id from app.claim_stale_deals(2000)')).rows);
    const byTenant = new Map<string, string[]>();
    for (const d of due) {
      if (!byTenant.has(d.tenant_id)) byTenant.set(d.tenant_id, []);
      byTenant.get(d.tenant_id)!.push(d.deal_id);
    }
    let sent = 0;
    for (const [tenantId, ids] of byTenant) {
      try {
        sent += await this.notifyTenant(tenantId, ids);
      } catch (err) {
        this.log.error(`aviso de negócio parado: ${String(err)}`);
      }
    }
    return sent;
  }

  /** Junta os negócios por pessoa e manda um resumo por WhatsApp e/ou no CRM. Devolve quantas mensagens saíram. */
  private async notifyTenant(tenantId: string, dealIds: string[]): Promise<number> {
    const ctx = { tenantId, userId: null };
    const rows = await this.db.app(ctx, async (q) => (await q.query<Row>(
      `select distinct on (d.id, m.id)
              d.id as deal_id, d.title, pl.name as pipeline, s.name as stage,
              floor(extract(epoch from now() - greatest(d.stage_entered_at, coalesce(d.last_activity_at, d.stage_entered_at))) / 86400)::int as idle,
              pl.stale_account_id as account_id, pl.stale_whatsapp as wa, pl.stale_in_app as in_app,
              m.id as member_id, m.notify_phone as phone, u.name as who
         from deals d
         join pipelines pl on pl.id = d.pipeline_id
         join pipeline_stages s on s.id = d.stage_id
         left join memberships mc on mc.id = d.created_by and mc.status = 'active'
         cross join lateral unnest(case pl.stale_recipients
             when 'creator' then array[case when mc.id is not null and (mc.notify_phone is not null or not pl.stale_whatsapp)
                                            then mc.id else d.owner_membership_id end]
             when 'owner' then array[d.owner_membership_id]
             when 'fixed' then pl.stale_member_ids
             else array[d.owner_membership_id] || pl.stale_member_ids end) as r(mid)
         join memberships m on m.id = r.mid and m.status = 'active'
         left join users u on u.id = m.user_id
        where d.id = any($1::uuid[])
        order by d.id, m.id`, [dealIds])).rows);

    // WhatsApp: um por pessoa e número de saída. CRM: um por pessoa.
    const wa = new Map<string, { accountId: string; phone: string; who: string | null; items: Item[] }>();
    const app = new Map<string, Item[]>();
    const names = new Map<string, Set<string>>();
    for (const r of rows) {
      const item: Item = { id: r.deal_id, title: r.title, pipeline: r.pipeline, stage: r.stage, idle: r.idle };
      let reached = false;
      if (r.wa && r.account_id && r.phone) {
        const key = `${r.member_id}|${r.account_id}`;
        if (!wa.has(key)) wa.set(key, { accountId: r.account_id, phone: r.phone, who: r.who, items: [] });
        wa.get(key)!.items.push(item);
        reached = true;
      }
      if (r.in_app) {
        if (!app.has(r.member_id)) app.set(r.member_id, []);
        app.get(r.member_id)!.push(item);
        reached = true;
      }
      if (reached) {
        if (!names.has(r.deal_id)) names.set(r.deal_id, new Set());
        names.get(r.deal_id)!.add(r.who ?? 'equipe');
      }
    }

    let sent = 0;
    for (const g of wa.values()) {
      try {
        if (sent > 0 && this.gapMs) await new Promise((res) => setTimeout(res, this.gapMs));
        await this.messages.sendNotice(tenantId, g.accountId, g.phone, { text: this.whatsappText(g.who, g.items), files: [] });
        sent++;
      } catch (err) {
        this.log.error(`aviso de negócio parado por WhatsApp: ${String(err)}`);
      }
    }

    await this.db.app(ctx, async (q) => {
      for (const [memberId, items] of app) {
        const one = items.length === 1 ? items[0]! : null;
        const title = one ? `Negócio parado há ${days(one.idle)}` : `${items.length} negócios sem movimentação`;
        const body = one
          ? `"${one.title}" (${one.pipeline} › ${one.stage}) está sem movimentação.`
          : sorted(items).slice(0, 3).map((i) => `"${i.title}" (${days(i.idle)})`).join(', ') + (items.length > 3 ? ` e mais ${items.length - 3}.` : '.');
        await q.query(
          `insert into notifications (tenant_id, membership_id, kind, title, body, link) values (app.tenant_id(), $1, 'deal.stale', $2, $3, $4)`,
          [memberId, title.slice(0, 200), body.slice(0, 1000), one ? `/negocios/${one.id}` : '/negocios?funil=todos&visao=lista&parados=1']);
      }
      const ids = [...names.keys()];
      if (ids.length) {
        const idle = new Map(rows.map((r) => [r.deal_id, r.idle]));
        await q.query(
          `insert into timeline_entries (tenant_id, kind, deal_id, data)
           select app.tenant_id(), 'deal.stale_notified', x.id, x.data from unnest($1::uuid[], $2::jsonb[]) as x(id, data)`,
          [ids, ids.map((id) => JSON.stringify({ days: idle.get(id), to: [...names.get(id)!].join(', ') }))]);
      }
    });
    return sent + app.size;
  }

  private whatsappText(who: string | null, items: Item[]): string {
    const first = (who ?? '').split(/\s+/)[0];
    if (items.length === 1) {
      const i = items[0]!;
      return `⏰ ${first ? `${first}, o` : 'O'} negócio "${i.title}" está sem movimentação há ${days(i.idle)} `
        + `(${i.pipeline} › ${i.stage}).\nAbrir: ${this.cfg.APP_URL}/negocios/${i.id}`;
    }
    const list = sorted(items);
    const lines = list.slice(0, TOP).map((i) => `• "${i.title}" — ${days(i.idle)} (${i.pipeline} › ${i.stage})`);
    if (list.length > TOP) lines.push(`… e mais ${list.length - TOP}.`);
    return `⏰ ${first ? `${first}, você tem` : 'Há'} ${items.length} negócios sem movimentação:\n${lines.join('\n')}\n`
      + `Ver todos: ${this.cfg.APP_URL}/negocios?funil=todos&visao=lista&parados=1`;
  }
}

function days(n: number): string {
  return `${n} ${n === 1 ? 'dia' : 'dias'}`;
}

function sorted(items: Item[]): Item[] {
  return [...items].sort((a, b) => b.idle - a.idle || a.title.localeCompare(b.title));
}
