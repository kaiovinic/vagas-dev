import { Module } from '@nestjs/common';

import { ApplicationModule } from '@/application/application.module';
import { CaptureController } from '@/http/controllers/capture.controller';
import { DashboardController } from '@/http/controllers/dashboard.controller';
import { HealthController } from '@/http/controllers/health.controller';
import { MarketController } from '@/http/controllers/market.controller';
import { JobsController } from '@/http/controllers/jobs.controller';
import { RulesController } from '@/http/controllers/rules.controller';
import { InfraModule } from '@/infra/infra.module';

@Module({
  // InfraModule entra por causa do healthcheck, que consulta o banco direto:
  // nao existe caso de uso para "o banco responde?".
  imports: [ApplicationModule, InfraModule],
  controllers: [
    CaptureController,
    DashboardController,
    HealthController,
    JobsController,
    MarketController,
    RulesController,
  ],
})
export class HttpModule {}
