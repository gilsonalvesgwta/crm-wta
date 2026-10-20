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
import { AdminController, PlatformController, WebhooksController } from './admin/admin.controller.js';
import { Storage } from './infra/storage.js';
import { TenantFeaturesService } from './admin/tenant-features.service.js';
import { TenantFeaturesController } from './admin/tenant-features.controller.js';
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
import { ChannelsService } from './crm/channels.service.js';
import { MessagesService } from './crm/messages.service.js';
import { ChannelsController, EvolutionWebhookController, MessagesController } from './crm/channels.controller.js';
import { ConversationsController, QuickRepliesController } from './crm/conversations.controller.js';
import { ConversationsService } from './crm/conversations.service.js';
import { OperationService } from './crm/operation.service.js';
import { SalesService } from './crm/sales.service.js';
import { ScheduledController } from './crm/scheduled.controller.js';
import { ScheduledService } from './crm/scheduled.service.js';
import { CampaignsController, UnsubscribeController } from './crm/campaigns.controller.js';
import { CampaignsService } from './crm/campaigns.service.js';
import { QuickRepliesService } from './crm/quick-replies.service.js';
import { Evolution } from './infra/evolution.js';
import { Meta } from './infra/meta.js';
import { MetaController, MetaWebhookController } from './crm/meta.controller.js';
import { MetaService } from './crm/meta.service.js';
import { BackupsService } from './backup/backups.service.js';
import { BackupsController, TenantBackupsController } from './backup/backups.controller.js';
import { AutomationsService } from './automations/automations.service.js';
import { AutomationsController } from './automations/automations.controller.js';
import { ApiKeysService } from './integrations/api-keys.service.js';
import { InboundService } from './integrations/inbound.service.js';
import { IntegrationsController } from './integrations/integrations.controller.js';
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
        HealthController, AuthController, AdminController, PlatformController, WebhooksController, TenantFeaturesController, ContactsController, OrganizationsController,
        CatalogController, PipelinesController, DealsController, LeadsController, ActivitiesController, RecordsController,
        ImportsController, PrivacyController, DashboardController, ChannelsController, MessagesController, ConversationsController, QuickRepliesController, CampaignsController, UnsubscribeController, ScheduledController, EvolutionWebhookController, MetaController, MetaWebhookController, BackupsController, TenantBackupsController, AutomationsController, IntegrationsController,
      ],
      providers: [
        { provide: CONFIG, useValue: cfg },
        Db,
        mailerProvider,
        AuthService,
        AdminService,
        PlatformService,
        Storage,
        TenantFeaturesService,
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
        Evolution, Meta, MetaService,
        MessagesService, OperationService, SalesService, ScheduledService, ConversationsService, QuickRepliesService, CampaignsService,
        ChannelsService,
        BackupsService,
        AutomationsService,
        ApiKeysService,
        InboundService,
        { provide: APP_GUARD, useClass: SessionGuard },
        { provide: APP_FILTER, useClass: ProblemFilter },
      ],
    };
  }
}
