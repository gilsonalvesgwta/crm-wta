import { Inject, Injectable, Logger } from '@nestjs/common';
import { CONFIG, type Config } from '../config.js';
import { Db } from '../infra/db.js';
import { MessagesService } from './messages.service.js';

/**
 * Negócio parado: avisa por WhatsApp quem cadastrou o negócio (ou o
 * responsável) que o card está sem movimentação, de tantos em tantos dias,
 * conforme a configuração do funil. O banco escolhe e marca os negócios
 * (app.claim_stale_deals), então o mesmo aviso não sai duas vezes.
 */
@Injectable()
export class StaleDealsService {
  private readonly log = new Logger('NegocioParado');

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(MessagesService) private readonly messages: MessagesService,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  async dispatch(): Promise<number> {
    const due = await this.db.dispatch(async (q) =>
      (await q.query<{ tenant_id: string; deal_id: string }>('select tenant_id, deal_id from app.claim_stale_deals(50)')).rows);
    let sent = 0;
    for (const d of due) {
      try {
        if (await this.notify(d.tenant_id, d.deal_id)) sent++;
      } catch (err) {
        this.log.error(`aviso de negócio parado: ${String(err)}`);
      }
    }
    return sent;
  }

  private async notify(tenantId: string, dealId: string): Promise<boolean> {
    const row = await this.db.app({ tenantId, userId: null }, async (q) => (await q.query<{
      title: string; pipeline: string; stage: string; account_id: string | null; idle: number; phone: string | null; who: string | null;
    }>(
      `select d.title, pl.name as pipeline, s.name as stage, pl.stale_account_id as account_id,
              floor(extract(epoch from now() - greatest(d.stage_entered_at, coalesce(d.last_activity_at, d.stage_entered_at))) / 86400)::int as idle,
              coalesce(mc.notify_phone, mo.notify_phone) as phone, coalesce(uc.name, uo.name) as who
         from deals d join pipelines pl on pl.id = d.pipeline_id join pipeline_stages s on s.id = d.stage_id
         left join memberships mc on mc.id = d.created_by and mc.status = 'active' and mc.notify_phone is not null
         left join users uc on uc.id = mc.user_id
         left join memberships mo on mo.id = d.owner_membership_id and mo.status = 'active'
         left join users uo on uo.id = mo.user_id
        where d.id = $1`, [dealId])).rows[0]);
    if (!row?.account_id || !row.phone) return false;
    const first = (row.who ?? '').split(/\s+/)[0];
    const text = `⏰ ${first ? `${first}, o` : 'O'} negócio "${row.title}" está sem movimentação há ${row.idle} ${row.idle === 1 ? 'dia' : 'dias'} `
      + `(${row.pipeline} › ${row.stage}).\nAbrir: ${this.cfg.APP_URL}/negocios/${dealId}`;
    await this.messages.sendNotice(tenantId, row.account_id, row.phone, { text, files: [] });
    await this.db.app({ tenantId, userId: null }, (q) => q.query(
      `insert into timeline_entries (tenant_id, kind, deal_id, data) values (app.tenant_id(), 'deal.stale_notified', $1, $2)`,
      [dealId, JSON.stringify({ days: row.idle, to: row.who })]));
    return true;
  }
}
