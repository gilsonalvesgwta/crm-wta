import pg from 'pg';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { CONFIG, type Config } from '../config.js';

export type Q = {
  query<R extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<pg.QueryResult<R>>;
};

export type TenantCtx = { tenantId: string | null; userId: string | null };

/**
 * Toda transação troca para um papel sem privilégio de dono (crm_app ou
 * crm_platform) e define o contexto. O papel de login, crm_api, não tem acesso
 * a tabela alguma: esquecer o contexto resulta em erro, não em vazamento.
 */
@Injectable()
export class Db implements OnModuleDestroy {
  readonly pool: pg.Pool;

  constructor(@Inject(CONFIG) cfg: Config) {
    this.pool = new pg.Pool({
      connectionString: cfg.DATABASE_URL,
      max: cfg.DATABASE_POOL_MAX,
      application_name: 'crm-api',
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  /** Transação no papel da aplicação, no contexto da empresa e do usuário. */
  app<T>(ctx: TenantCtx, fn: (q: Q) => Promise<T>): Promise<T> {
    return this.tx('crm_app', ctx, fn);
  }

  /** Transação sem empresa: só para as funções de autenticação. */
  auth<T>(fn: (q: Q) => Promise<T>): Promise<T> {
    return this.tx('crm_app', { tenantId: null, userId: null }, fn);
  }

  /** Transação da administração da plataforma. */
  platform<T>(userId: string | null, fn: (q: Q) => Promise<T>): Promise<T> {
    return this.tx('crm_platform', { tenantId: null, userId }, fn);
  }

  /** Transação do despachante: escolhe itens entre empresas, só pelas funções do banco. */
  dispatch<T>(fn: (q: Q) => Promise<T>): Promise<T> {
    return this.tx('crm_dispatch', { tenantId: null, userId: null }, fn);
  }

  async ping(): Promise<void> {
    await this.pool.query('select 1');
  }

  private async tx<T>(role: 'crm_app' | 'crm_platform' | 'crm_dispatch', ctx: TenantCtx, fn: (q: Q) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query(`set local role ${role}`);
      await client.query(
        "select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)",
        [ctx.tenantId ?? '', ctx.userId ?? ''],
      );
      const out = await fn(client);
      await client.query('commit');
      return out;
    } catch (err) {
      await client.query('rollback').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
}

/** Código SQLSTATE de um erro do Postgres, quando houver. */
export function pgCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : undefined;
}
