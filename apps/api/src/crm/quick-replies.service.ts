import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../access/actor.js';
import { tenantCtx } from '../access/decorators.js';
import { Problem } from '../http/problem.js';
import { Db, pgCode, type Q } from '../infra/db.js';
import { memberJson } from './fields.js';

export type QuickReplyInput = {
  channel: 'whatsapp' | 'email'; shortcut: string; title: string; subject?: string | null; body: string; shared: boolean;
};

const COLUMNS = `r.id, r.channel, r.shortcut, r.title, r.subject, r.body, r.owner_membership_id is null as shared,
  r.updated_at as "updatedAt", ${memberJson('r.created_by')} as "createdBy"`;

/**
 * Banco de respostas prontas. As da empresa (todos usam) são mantidas por quem
 * edita modelos e campanhas; cada pessoa que responde conversas tem as suas.
 */
@Injectable()
export class QuickRepliesService {
  constructor(@Inject(Db) private readonly db: Db) {}

  private canShare(actor: Actor): boolean {
    return actor.permissions.has('campaigns:edit');
  }

  async list(actor: Actor, f: { channel?: 'whatsapp' | 'email'; q?: string }) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const r = await q.query(
        `select ${COLUMNS} from quick_replies r
          where (r.owner_membership_id is null or r.owner_membership_id = $1)
            and ($2::text is null or r.channel = $2)
            and ($3::text is null or app.norm(r.shortcut || ' ' || r.title || ' ' || r.body) like '%' || app.norm($3) || '%')
          order by r.channel, r.shortcut, r.owner_membership_id nulls first`, [actor.membershipId, f.channel ?? null, f.q ?? null]);
      return { items: r.rows, canShare: this.canShare(actor) };
    });
  }

  private async mine(q: Q, actor: Actor, id: string) {
    const r = await q.query<{ owner_membership_id: string | null }>('select owner_membership_id from quick_replies where id = $1', [id]);
    const row = r.rows[0];
    if (!row || (row.owner_membership_id && row.owner_membership_id !== actor.membershipId)) throw Problem.notFound('Resposta não encontrada.');
    if (!row.owner_membership_id && !this.canShare(actor)) throw Problem.forbidden('Só quem edita os modelos da empresa altera as respostas da empresa.');
    return row;
  }

  private dup(err: unknown): never {
    if (pgCode(err) === '23505') {
      throw Problem.badRequest('Atalho já usado.', [{ field: 'shortcut', message: 'Já existe uma resposta com esse atalho neste canal.' }]);
    }
    throw err;
  }

  async create(actor: Actor, b: QuickReplyInput) {
    if (b.shared && !this.canShare(actor)) throw Problem.forbidden('Só quem edita os modelos da empresa cria respostas para todos.');
    if (b.channel === 'email' && !b.subject) {
      throw Problem.badRequest('Falta o assunto.', [{ field: 'subject', message: 'Escreva o assunto do e-mail.' }]);
    }
    return this.db.app(tenantCtx(actor), async (q) => {
      try {
        await q.query('savepoint resp');
        const r = await q.query<{ id: string }>(
          `insert into quick_replies (tenant_id, channel, shortcut, title, subject, body, owner_membership_id, created_by)
           values (app.tenant_id(), $1, $2, $3, $4, $5, $6, $7) returning id`,
          [b.channel, b.shortcut, b.title, b.channel === 'email' ? b.subject : null, b.body, b.shared ? null : actor.membershipId, actor.membershipId]);
        return (await q.query(`select ${COLUMNS} from quick_replies r where r.id = $1`, [r.rows[0]!.id])).rows[0];
      } catch (err) {
        await q.query('rollback to savepoint resp');
        return this.dup(err);
      }
    });
  }

  async update(actor: Actor, id: string, b: QuickReplyInput) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const row = await this.mine(q, actor, id);
      if (b.shared !== (row.owner_membership_id === null)) {
        if (!this.canShare(actor)) throw Problem.forbidden('Só quem edita os modelos da empresa compartilha respostas.');
      }
      try {
        await q.query('savepoint resp');
        await q.query(
          `update quick_replies set channel = $2, shortcut = $3, title = $4, subject = $5, body = $6, owner_membership_id = $7 where id = $1`,
          [id, b.channel, b.shortcut, b.title, b.channel === 'email' ? b.subject : null, b.body, b.shared ? null : actor.membershipId]);
      } catch (err) {
        await q.query('rollback to savepoint resp');
        this.dup(err);
      }
      return (await q.query(`select ${COLUMNS} from quick_replies r where r.id = $1`, [id])).rows[0];
    });
  }

  async remove(actor: Actor, id: string) {
    await this.db.app(tenantCtx(actor), async (q) => {
      await this.mine(q, actor, id);
      await q.query('delete from quick_replies where id = $1', [id]);
    });
  }
}
