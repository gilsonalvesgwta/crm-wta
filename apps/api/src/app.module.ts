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
import { Storage } from './infra/storage.js';
import { ActivitiesService } from './crm/activities.service.js';
import { CatalogService } from './crm/catalog.service.js';
import { ContactsService } from './crm/contacts.service.js';
import { DashboardService } from './crm/dashboard.service.js';
import { DealsService } from './crm/deals.service.js';
import { DispatcherService } from './crm/dispatcher.service.js';
import { FilesService } from './crm/files.service.js';
import { ImportExportService } from './crm/import-export.service.js';
import { LeadsService } from './crm/leads.service.js';
import { OrganizationsService } from './crm/organizations.service.js';
import { PipelinesService } from './crm/pipelines.service.js';
import { PrivacyService } from './crm/privacy.service.js';
import { RecordsService } from './crm/records.service.js';
import {
  ActivitiesController, CatalogController, ContactsController, DashboardController, DealsController, ImportsController,
  LeadsController, OrganizationsController, PipelinesController, PrivacyController, RecordsController,
} from './crm/crm.controller.js';

@Module({})
export class AppModule {
  static register(cfg: Config): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        HealthController, AuthController, AdminController, PlatformController, ContactsController, OrganizationsController,
        CatalogController, PipelinesController, DealsController, LeadsController, ActivitiesController, RecordsController,
        ImportsController, PrivacyController, DashboardController,
      ],
      providers: [
        { provide: CONFIG, useValue: cfg },
        Db,
        mailerProvider,
        AuthService,
        AdminService,
        PlatformService,
        Storage,
        ContactsService,
        OrganizationsService,
        CatalogService,
        PipelinesService,
        DealsService,
        LeadsService,
        ActivitiesService,
        RecordsService,
        FilesService,
        ImportExportService,
        PrivacyService,
        DashboardService,
        DispatcherService,
        { provide: APP_GUARD, useClass: SessionGuard },
        { provide: APP_FILTER, useClass: ProblemFilter },
      ],
    };
  }
}
