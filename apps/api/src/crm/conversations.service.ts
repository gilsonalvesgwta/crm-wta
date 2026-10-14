import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../access/actor.js';
import { tenantCtx } from '../access/decorators.js';
import { Problem } from '../http/problem.js';
import { Db, type Q } from '../infra/db.js';
import { contactOwnExtra } from './contacts.service.js';
import { memberJson } from './fields.js';
import { MESSAGE_COLUMNS, MessagesService, type SendInput, type Upload } from './messages.service.js';
import { Params, reachSql, tryReach } from './sql.js';

const RANK = { own: 1, team: 2, tenant: 3 } as const;

export type Channel = 'whatsapp' | 'email';
export type ConversationStatus = 'open' | 'waiting' | 'closed';

export type InboxFilter = {
  status?: ConversationStatus | 'all';
  channel?: Channel;
  unread?: boolean;
  q?: string;
  tagId?: string;
  /** 'me', 'none' ou o id de uma pessoa. */
  assignee?: string;
  teamId?: string;
  /** 'open': com negócio aberto; 'none': sem negócio aberto; ou o id de um funil. */
  deal?: string;
  page: number;
  pageSize: number;
};

const COLUMNS = `
  v.id, v.channel, v.status, v.contact_id as "contactId", v.opened_at as "openedAt", v.first_response_at as "firstResponseAt",
  v.last_message_at as "lastMessageAt", v.last_in_at as "lastInAt", v.last_out_at as "lastOutAt", v.closed_at as "closedAt",
  ${memberJson('v.assignee_membership_id')} as assignee,
  (select json_build_object('id', t.id, 'name', t.name) from teams t where t.id = v.team_id) as team,
  json_build_object('id', c.id, 'name', c.name,
    'phone', (select p.e164 from contact_phones p where p.contact_id = c.id order by p.is_primary desc, p.created_at limit 1),
    'email', (select e.email from contact_emails e where e.contact_id = c.id order by e.is_primary desc, e.created_at limit 1),
    'tags', coalesce((select json_agg(json_build_object('id', g.id, 'name', g.name, 'color', g.color) order by g.name)
                        from contact_tags ct join tags g on g.id = ct.tag_id where ct.contact_id = c.id), '[]'::json)) as contact,
  (select count(*)::int from messages m where m.contact_id = v.contact_id and m.channel = v.channel
     and m.direction = 'in' and m.seen_at is null) as unread,
  (select json_build_object('id', m.id, 'direction', m.direction, 'status', m.status, 'kind', m.kind,
                            'body', left(m.body, 200), 'subject', m.subject, 'createdAt', m.created_at)
     from messages m where m.contact_id = v.contact_id and m.channel = v.channel order by m.created_at desc limit 1) as "last"`;

/**
 * Conversas: uma por contato e canal, com estado, responsável e equipe.
 * Quem vê: pelo alcance de "conversations:reply" (as atribuídas a si, as da
 * equipe e as dos contatos no alcance) e, com "conversations:take", as sem
 * responsável da sua equipe (ou sem equipe).
 */
@Injectable()
export class ConversationsService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(MessagesService) private readonly messages: MessagesService,
  ) {}

  /** Filtro de visibilidade sobre a conversa (v) e o contato (c). */
  visibleSql(p: Params, actor: Actor): string {
    const r = tryReach(actor, 'conversations:reply');
    if (!r) throw Problem.forbidden();
    if (r.scope === 'tenant') return 'true';
    const me = p.add(r.me);
    const parts = [`v.assignee_membership_id = ${me}`];
    // Contatos no alcance: o menor entre ver contatos e responder conversas.
    const contacts = tryReach(actor, 'contacts:view');
    if (contacts) {
      const scope = RANK[contacts.scope] < RANK[r.scope] ? contacts.scope : r.scope;
      parts.push(reachSql(p, 'c', { ...contacts, scope }, contactOwnExtra));
    }
    if (r.scope === 'team' && r.teams.length) {
      const teams = p.add(r.teams);
      parts.push(`v.team_id = any(${teams}::uuid[])`);
      parts.push(`v.assignee_membership_id in (select tm.membership_id from team_members tm where tm.team_id = any(${teams}::uuid[]))`);
    }
    const take = tryReach(actor, 'conversations:take');
    if (take) {
      if (take.scope === 'tenant') parts.push('v.assignee_membership_id is null');
      else parts.push(`(v.assignee_membership_id is null and (v.team_id is null or v.team_id = any(${p.add(take.teams)}::uuid[])))`);
    }
    return `(${parts.join(' or ')})`;
  }

  private async visible(q: Q, actor: Actor, id: string) {
    const p = new Params();
    const idp = p.add(id);
    const r = await q.query<{ id: string; contact_id: string; channel: Channel; assignee_membership_id: string | null; team_id: string | null }>(
      `select v.id, v.contact_id, v.channel, v.assignee_membership_id, v.team_id from conversations v join contacts c on c.id = v.contact_id
        where v.id = ${idp} and c.anonymized_at is null and ${this.visibleSql(p, actor)}`, p.values);
    if (!r.rows[0]) throw Problem.notFound('Conversa não encontrada.');
    return r.rows[0];
  }

  async inbox(actor: Actor, f: InboxFilter) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const p = new Params();
      const base = [this.visibleSql(p, actor), 'c.anonymized_at is null'];
      if (f.channel) base.push(`v.channel = ${p.add(f.channel)}`);
      if (f.q) base.push(`app.norm(c.name) like '%' || app.norm(${p.add(f.q)}) || '%'`);
      if (f.tagId) base.push(`exists (select 1 from contact_tags ct where ct.contact_id = c.id and ct.tag_id = ${p.add(f.tagId)})`);
      if (f.assignee === 'me') base.push(`v.assignee_membership_id = ${p.add(actor.membershipId)}`);
      else if (f.assignee === 'none') base.push('v.assignee_membership_id is null');
      else if (f.assignee) base.push(`v.assignee_membership_id = ${p.add(f.assignee)}`);
      if (f.teamId) base.push(`v.team_id = ${p.add(f.teamId)}`);
      if (f.deal === 'open') base.push(`exists (select 1 from deals d where d.contact_id = c.id and d.status = 'open')`);
      else if (f.deal === 'none') base.push(`not exists (select 1 from deals d where d.contact_id = c.id and d.status = 'open')`);
      else if (f.deal) base.push(`exists (select 1 from deals d where d.contact_id = c.id and d.status = 'open' and d.pipeline_id = ${p.add(f.deal)})`);
      if (f.unread) base.push(`exists (select 1 from messages m where m.contact_id = v.contact_id and m.channel = v.channel and m.direction = 'in' and m.seen_at is null)`);

      // Contagem por estado com os mesmos filtros (para as abas).
      const counts = await q.query<{ status: ConversationStatus; n: number }>(
        `select v.status, count(*)::int as n from conversations v join contacts c on c.id = v.contact_id
          where ${base.join(' and ')} group by v.status`, p.values);

      const where = [...base];
      if (f.status && f.status !== 'all') where.push(`v.status = ${p.add(f.status)}`);
      const limit = p.add(f.pageSize);
      const offset = p.add((f.page - 1) * f.pageSize);
      const r = await q.query(
        `select ${COLUMNS}, count(*) over ()::int as total
           from conversations v join contacts c on c.id = v.contact_id
          where ${where.join(' and ')}
          order by v.last_message_at desc
          limit ${limit} offset ${offset}`, p.values);
      const byStatus = Object.fromEntries(counts.rows.map((x) => [x.status, x.n]));
      return {
        items: r.rows.map(({ total: _t, ...rest }) => rest),
        total: (r.rows[0] as { total?: number } | undefined)?.total ?? 0, page: f.page, pageSize: f.pageSize,
        counts: { open: byStatus.open ?? 0, waiting: byStatus.waiting ?? 0, closed: byStatus.closed ?? 0 },
      };
    });
  }

  /** Conversas visíveis com mensagem recebida ainda não vista (para o menu). */
  async unreadCount(actor: Actor) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const p = new Params();
      const r = await q.query<{ n: number }>(
        `select count(*)::int as n from conversations v join contacts c on c.id = v.contact_id
          where ${this.visibleSql(p, actor)} and c.anonymized_at is null
            and exists (select 1 from messages m where m.contact_id = v.contact_id and m.channel = v.channel and m.direction = 'in' and m.seen_at is null)`,
        p.values);
      return { count: r.rows[0]!.n };
    });
  }

  async get(actor: Actor, id: string) {
    return this.db.app(tenantCtx(actor), async (q) => {
      await this.visible(q, actor, id);
      return (await q.query(`select ${COLUMNS} from conversations v join contacts c on c.id = v.contact_id where v.id = $1`, [id])).rows[0];
    });
  }

  async history(actor: Actor, id: string, before?: string) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const v = await this.visible(q, actor, id);
      const r = await q.query(
        `select * from (select ${MESSAGE_COLUMNS} from messages m
           where m.contact_id = $1 and m.channel = $2 and ($3::timestamptz is null or m.created_at < $3)
           order by m.created_at desc limit 200) x order by "createdAt"`, [v.contact_id, v.channel, before ?? null]);
      return { items: r.rows };
    });
  }

  async markSeen(actor: Actor, id: string) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const v = await this.visible(q, actor, id);
      const r = await q.query(
        "update messages set seen_at = now() where contact_id = $1 and channel = $2 and direction = 'in' and seen_at is null", [v.contact_id, v.channel]);
      return { marked: r.rowCount ?? 0 };
    });
  }

  async send(actor: Actor, id: string, input: SendInput, file?: Upload) {
    const v = await this.db.app(tenantCtx(actor), (q) => this.visible(q, actor, id));
    return this.messages.sendInConversation(actor, v.contact_id, v.channel, input, file);
  }

  /** Abre (ou acha) a conversa com um contato num canal, mesmo sem mensagem nenhuma ainda. */
  async start(actor: Actor, contactId: string, channel: Channel) {
    return this.db.app(tenantCtx(actor), async (q) => {
      // Precisa ver o contato para começar a conversar com ele.
      const p = new Params();
      const cr = tryReach(actor, 'contacts:view');
      if (!cr) throw Problem.forbidden();
      const c = await q.query<{ id: string; owner_membership_id: string | null; team_id: string | null; anonymized_at: string | null }>(
        `select c.id, c.owner_membership_id, c.team_id, c.anonymized_at from contacts c where c.id = ${p.add(contactId)} and ${reachSql(p, 'c', cr, contactOwnExtra)}`, p.values);
      const k = c.rows[0];
      if (!k || k.anonymized_at) throw Problem.notFound('Contato não encontrado.');
      const has = channel === 'whatsapp'
        ? await q.query('select 1 from contact_phones where contact_id = $1', [contactId])
        : await q.query('select 1 from contact_emails where contact_id = $1', [contactId]);
      if (!has.rowCount) {
        throw Problem.badRequest(channel === 'whatsapp' ? 'O contato não tem telefone.' : 'O contato não tem e-mail.',
          [{ field: 'channel', message: channel === 'whatsapp' ? 'Cadastre um telefone no contato.' : 'Cadastre um e-mail no contato.' }]);
      }
      const r = await q.query<{ id: string }>(
        `insert into conversations (tenant_id, contact_id, channel, assignee_membership_id, team_id)
         values (app.tenant_id(), $1, $2, coalesce($3::uuid, $4::uuid), $5::uuid)
         on conflict (tenant_id, contact_id, channel) do update
           set assignee_membership_id = coalesce(conversations.assignee_membership_id, excluded.assignee_membership_id),
               status = case when conversations.status = 'closed' then 'open' else conversations.status end,
               opened_at = case when conversations.status = 'closed' then now() else conversations.opened_at end,
               first_response_at = case when conversations.status = 'closed' then null else conversations.first_response_at end,
               closed_at = null
         returning id`, [contactId, channel, k.owner_membership_id, actor.membershipId, k.team_id]);
      return (await q.query(`select ${COLUMNS} from conversations v join contacts c on c.id = v.contact_id where v.id = $1`, [r.rows[0]!.id])).rows[0];
    });
  }

  /** Estado, responsável e equipe. Atribuir a outra pessoa pede "conversations:assign". */
  async update(actor: Actor, id: string, b: { status?: ConversationStatus; assigneeId?: string | null; teamId?: string | null }) {
    return this.db.app(tenantCtx(actor), async (q) => {
      const v = await this.visible(q, actor, id);
      const sets: string[] = [];
      const vals: unknown[] = [id];
      const add = (col: string, val: unknown) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };
      if (b.status) {
        add('status', b.status);
        sets.push(b.status === 'closed' ? 'closed_at = now()' : 'closed_at = null');
      }
      if (b.assigneeId !== undefined && b.assigneeId !== v.assignee_membership_id) {
        const assign = tryReach(actor, 'conversations:assign');
        const take = tryReach(actor, 'conversations:take');
        const self = b.assigneeId === actor.membershipId;
        if (self) {
          // Assumir: quem atribui, ou quem pode assumir uma conversa sem responsável.
          if (!assign && !(take && v.assignee_membership_id === null)) throw Problem.forbidden('Você não pode assumir esta conversa.');
        } else {
          if (!assign) throw Problem.forbidden('Você não pode atribuir conversas a outra pessoa.');
          if (b.assigneeId) {
            const m = await q.query<{ status: string }>('select status from memberships where id = $1', [b.assigneeId]);
            if (m.rows[0]?.status !== 'active') {
              throw Problem.badRequest('Responsável inválido.', [{ field: 'assigneeId', message: 'Escolha uma pessoa ativa da empresa.' }]);
            }
            if (assign.scope !== 'tenant') {
              const t = await q.query('select 1 from team_members where membership_id = $1 and team_id = any($2::uuid[])', [b.assigneeId, assign.teams]);
              if (!t.rowCount) throw Problem.badRequest('Responsável fora do seu alcance.', [{ field: 'assigneeId', message: 'Você só pode atribuir à sua equipe.' }]);
            }
          }
        }
        add('assignee_membership_id', b.assigneeId);
      }
      if (b.teamId !== undefined && b.teamId !== v.team_id) {
        const assign = tryReach(actor, 'conversations:assign');
        if (!assign) throw Problem.forbidden('Você não pode trocar a equipe da conversa.');
        if (b.teamId) {
          const t = await q.query('select 1 from teams where id = $1', [b.teamId]);
          if (!t.rowCount) throw Problem.badRequest('Equipe inválida.', [{ field: 'teamId', message: 'Escolha uma equipe da empresa.' }]);
          if (assign.scope !== 'tenant' && !assign.teams.includes(b.teamId)) {
            throw Problem.badRequest('Equipe fora do seu alcance.', [{ field: 'teamId', message: 'Escolha uma das suas equipes.' }]);
          }
        }
        add('team_id', b.teamId);
      }
      if (sets.length) {
        await q.query(`update conversations set ${sets.join(', ')} where id = $1`, vals);
        await q.query(
          `insert into timeline_entries (tenant_id, kind, actor_membership_id, contact_id, data) values (app.tenant_id(), 'conversation.updated', $1, $2, $3)`,
          [actor.membershipId, v.contact_id, JSON.stringify({ conversationId: id, channel: v.channel, ...b })]);
      }
      return (await q.query(`select ${COLUMNS} from conversations v join contacts c on c.id = v.contact_id where v.id = $1`, [id])).rows[0];
    });
  }
}
