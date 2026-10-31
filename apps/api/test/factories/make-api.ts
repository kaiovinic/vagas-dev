import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { GetDashboardChartsUseCase } from '@/application/use-cases/get-dashboard-charts.use-case';
import { GetDashboardSummaryUseCase } from '@/application/use-cases/get-dashboard-summary.use-case';
import { GetSourceHealthUseCase } from '@/application/use-cases/get-source-health.use-case';
import { ListJobsUseCase } from '@/application/use-cases/list-jobs.use-case';
import { TestJobRulesUseCase } from '@/application/use-cases/test-job-rules.use-case';
import { CAPTURE_LOG_REPOSITORY } from '@/domain/repositories/capture-log-repository';
import { DASHBOARD_METRICS_REPOSITORY } from '@/domain/repositories/dashboard-metrics-repository';
import { JOB_QUERY_REPOSITORY } from '@/domain/repositories/job-query-repository';
import { SOURCE_HEALTH_REPOSITORY } from '@/domain/repositories/source-health-repository';
import { JobRuleEngine } from '@/domain/services/job-rule-engine';
import { DashboardController } from '@/http/controllers/dashboard.controller';
import { JobsController } from '@/http/controllers/jobs.controller';
import { RulesController } from '@/http/controllers/rules.controller';
import { DomainExceptionFilter } from '@/http/filters/domain-exception.filter';

import {
  InMemoryCaptureLogRepository,
  StubDashboardMetricsRepository,
  StubJobQueryRepository,
  StubSourceHealthRepository,
} from './doubles';

export interface ApiTestContext {
  readonly app: INestApplication;
  readonly metrics: StubDashboardMetricsRepository;
  readonly jobs: StubJobQueryRepository;
  readonly captureLogs: InMemoryCaptureLogRepository;
  readonly sourceHealth: StubSourceHealthRepository;
}

/**
 * Sobe a camada HTTP real (controllers, pipes, filtros e serializacao do Nest)
 * com os repositorios substituidos por duplos em memoria, sem Postgres nem rede.
 */
export async function createApiTestContext(): Promise<ApiTestContext> {
  const metrics = new StubDashboardMetricsRepository();
  const jobs = new StubJobQueryRepository();
  const captureLogs = new InMemoryCaptureLogRepository();
  const sourceHealth = new StubSourceHealthRepository();

  const moduleRef = await Test.createTestingModule({
    controllers: [DashboardController, JobsController, RulesController],
    providers: [
      JobRuleEngine,
      GetDashboardSummaryUseCase,
      GetDashboardChartsUseCase,
      GetSourceHealthUseCase,
      ListJobsUseCase,
      TestJobRulesUseCase,
      { provide: DASHBOARD_METRICS_REPOSITORY, useValue: metrics },
      { provide: JOB_QUERY_REPOSITORY, useValue: jobs },
      { provide: CAPTURE_LOG_REPOSITORY, useValue: captureLogs },
      { provide: SOURCE_HEALTH_REPOSITORY, useValue: sourceHealth },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();

  app.useGlobalFilters(new DomainExceptionFilter());

  await app.init();

  return { app, metrics, jobs, captureLogs, sourceHealth };
}
