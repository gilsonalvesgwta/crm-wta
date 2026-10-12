import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { CONFIG, type Config } from '../config.js';
import { Db } from '../infra/db.js';
import { ActivitiesService } from './activities.service.js';
import { ImportExportService } from './import-export.service.js';

/**
 * Trabalho em segundo plano da Fase 2, dentro do processo da API: lembretes,
 * importações e extensão das séries recorrentes. O estado fica todo no banco,
 * e cada item é reservado por função com SKIP LOCKED, então várias réplicas
 * podem rodar juntas sem repetir trabalho. Na Fase 3 isto passa para o worker.
 */
@Injectable()
export class DispatcherService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('despachante');
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private stopping = false;

  constructor(
    @Inject(CONFIG) private readonly cfg: Config,
    @Inject(Db) private readonly db: Db,
    @Inject(ActivitiesService) private readonly activities: ActivitiesService,
    @Inject(ImportExportService) private readonly imports: ImportExportService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.cfg.DISPATCH_INTERVAL_S <= 0) return;
    this.timer = setInterval(() => {
      if (!this.running) {
        this.running = this.runOnce().then(() => undefined).catch((err) => this.log.error(String(err instanceof Error ? err.stack : err))).finally(() => {
          this.running = null;
        });
      }
    }, this.cfg.DISPATCH_INTERVAL_S * 1000);
    this.timer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  /** Uma rodada completa. Exposto para os testes. */
  async runOnce(budgetMs = 10_000): Promise<{ reminders: number; importBatches: number; seriesExtended: number }> {
    const started = Date.now();
    const reminders = await this.reminders();
    let importBatches = 0;
    while (!this.stopping && Date.now() - started < budgetMs) {
      const claimed = await this.db.dispatch(async (q) =>
        (await q.query<{ tenant_id: string; import_id: string }>('select tenant_id, import_id from app.claim_import(120)')).rows[0]);
      if (!claimed) break;
      let done = false;
      while (!done && !this.stopping && Date.now() - started < budgetMs) {
        done = await this.imports.processBatch(claimed.tenant_id, claimed.import_id);
        importBatches++;
      }
      if (!done) {
        // Sem tempo nesta rodada: libera a trava para continuar na próxima.
        await this.db.app({ tenantId: claimed.tenant_id, userId: null }, (q) =>
          q.query('update imports set locked_until = now() where id = $1', [claimed.import_id]));
      }
    }
    const seriesExtended = await this.extendSeries();
    return { reminders, importBatches, seriesExtended };
  }

  private async reminders(): Promise<number> {
    const due = await this.db.dispatch(async (q) =>
      (await q.query<{ tenant_id: string; activity_id: string }>('select tenant_id, activity_id from app.claim_due_reminders(200)')).rows);
    for (const d of due) {
      await this.db.app({ tenantId: d.tenant_id, userId: null }, async (q) => {
        const a = await q.query<{ owner_membership_id: string; title: string; starts_at: Date; timezone: string }>(
          `select a.owner_membership_id, a.title, a.starts_at, t.timezone from activities a join tenants t on t.id = a.tenant_id where a.id = $1`,
          [d.activity_id]);
        const row = a.rows[0];
        if (!row) return;
        const when = new Intl.DateTimeFormat('pt-BR', { timeZone: row.timezone, dateStyle: 'short', timeStyle: 'short' }).format(row.starts_at);
        await q.query(
          `insert into notifications (tenant_id, membership_id, kind, title, body, link, activity_id)
           values (app.tenant_id(), $1, 'activity.reminder', $2, $3, $4, $5)`,
          [row.owner_membership_id, row.title, `Começa ${when}`, `/agenda?atividade=${d.activity_id}`, d.activity_id]);
      });
    }
    return due.length;
  }

  private async extendSeries(): Promise<number> {
    // Estende quando faltam menos de 11 meses de ocorrências criadas.
    const until = new Date(Date.now() + 335 * 86_400_000);
    const list = await this.db.dispatch(async (q) =>
      (await q.query<{ tenant_id: string; series_id: string }>('select tenant_id, series_id from app.series_needing_extension($1, 50)', [until])).rows);
    let n = 0;
    for (const s of list) {
      n += await this.db.app({ tenantId: s.tenant_id, userId: null }, (q) => this.activities.extendSeries(q, s.series_id));
    }
    return n;
  }
}
