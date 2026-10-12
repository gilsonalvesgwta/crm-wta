import { Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { CONFIG, type Config } from './config.js';
import { Db } from './infra/db.js';
import { mailerProvider } from './infra/mailer.js';
import { ProblemFilter } from './http/problem.js';
import { SessionGuard } from './access/session.guard.js';
import { AuthService } from './auth/auth.service.js';
import { AuthController } from './auth/auth.controller.js';
import { HealthController } from './health/health.controller.js';
import { AdminService } from './admin/admin.service.js';
import { PlatformService } from './admin/platform.service.js';
import { AdminController, PlatformController } from './admin/admin.controller.js';

@Module({})
export class AppModule {
  static register(cfg: Config): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController, AuthController, AdminController, PlatformController],
      providers: [
        { provide: CONFIG, useValue: cfg },
        Db,
        mailerProvider,
        AuthService,
        AdminService,
        PlatformService,
        { provide: APP_GUARD, useClass: SessionGuard },
        { provide: APP_FILTER, useClass: ProblemFilter },
      ],
    };
  }
}
