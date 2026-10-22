import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Controller, Get, Inject, Logger } from '@nestjs/common';
import { Public } from '../access/decorators.js';
import { Db } from '../infra/db.js';
import { Problem } from '../http/problem.js';

/** Migrações que acompanham esta versão: /app/db/migrations na imagem, packages/db/migrations no repositório. */
export function bundledMigrations(from = path.dirname(fileURLToPath(import.meta.url))): string[] | null {
  let dir = from;
  for (let i = 0; i < 8; i++) {
    for (const cand of [path.join(dir, 'db', 'migrations'), path.join(dir, 'packages', 'db', 'migrations')]) {
      try {
        return readdirSync(cand).filter((f) => f.endsWith('.sql')).map((f) => f.slice(0, -4)).sort();
      } catch {
        // tenta o próximo
      }
    }
    dir = path.dirname(dir);
  }
  return null;
}

@Controller()
export class HealthController {
  private readonly log = new Logger('saude');
  private readonly expected = bundledMigrations();
  private migrated = false;

  constructor(@Inject(Db) private readonly db: Db) {}

  /** Migrações desta versão que o banco ainda não tem. Banco fora do ar não conta: não é motivo para reiniciar a API. */
  private async pending(): Promise<string[]> {
    if (this.migrated || !this.expected) return [];
    try {
      const applied = await this.db.auth(async (q) =>
        new Set((await q.query<{ name: string }>('select name from ctl.migrations')).rows.map((r) => r.name)));
      const missing = this.expected.filter((m) => !applied.has(m));
      if (!missing.length) this.migrated = true;
      return missing;
    } catch (err) {
      this.log.warn(`não foi possível conferir as migrações: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  /**
   * Usada pela verificação de saúde do contêiner. Numa atualização, a versão
   * nova só fica saudável (e recebe tráfego) depois que o banco tem as
   * migrações dela; até lá, a versão anterior continua atendendo.
   */
  @Public()
  @Get('healthz')
  async health() {
    const missing = await this.pending();
    if (missing.length) throw new Problem(503, `Aguardando as migrações: ${missing.join(', ')}.`, 'migrations-pending');
    return { status: 'ok', version: process.env.VERSAO ?? 'dev' };
  }

  @Public()
  @Get('readyz')
  async ready() {
    try {
      await this.db.ping();
    } catch {
      throw new Problem(503, 'Banco de dados indisponível.', 'unavailable');
    }
    const missing = await this.pending();
    if (missing.length) throw new Problem(503, `Aguardando as migrações: ${missing.join(', ')}.`, 'migrations-pending');
    return { status: 'ok', database: 'ok', version: process.env.VERSAO ?? 'dev' };
  }
}
