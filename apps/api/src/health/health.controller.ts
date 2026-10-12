import { Controller, Get, Inject } from '@nestjs/common';
import { Public } from '../access/decorators.js';
import { Db } from '../infra/db.js';
import { Problem } from '../http/problem.js';

@Controller()
export class HealthController {
  constructor(@Inject(Db) private readonly db: Db) {}

  @Public()
  @Get('healthz')
  health() {
    return { status: 'ok' };
  }

  @Public()
  @Get('readyz')
  async ready() {
    try {
      await this.db.ping();
    } catch {
      throw new Problem(503, 'Banco de dados indisponível.', 'unavailable');
    }
    return { status: 'ok', database: 'ok' };
  }
}
