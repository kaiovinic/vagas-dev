import { Module } from '@nestjs/common';

import { JobRuleEngine } from '@/domain/services/job-rule-engine';
import { CAPTURE_SCHEDULE } from '@/domain/providers/capture-schedule';
import { CronCaptureSchedule } from '@/application/schedulers/cron-capture-schedule';
import { CaptureCoordinator } from '@/application/services/capture-coordinator.service';
import { JobCronScheduler } from '@/application/schedulers/job-cron.scheduler';
import { WeeklyDigestScheduler } from '@/application/schedulers/weekly-digest.scheduler';
import { GetMarketInsightsUseCase } from '@/application/use-cases/get-market-insights.use-case';
import { GetDashboardChartsUseCase } from '@/application/use-cases/get-dashboard-charts.use-case';
import { GetDashboardSummaryUseCase } from '@/application/use-cases/get-dashboard-summary.use-case';
import { ListJobsUseCase } from '@/application/use-cases/list-jobs.use-case';
import { RunJobCollectionUseCase } from '@/application/use-cases/run-job-collection.use-case';
import { SendWeeklyDigestUseCase } from '@/application/use-cases/send-weekly-digest.use-case';
import { TestJobRulesUseCase } from '@/application/use-cases/test-job-rules.use-case';
import { InfraModule } from '@/infra/infra.module';

const USE_CASES = [
  RunJobCollectionUseCase,
  GetDashboardSummaryUseCase,
  GetDashboardChartsUseCase,
  ListJobsUseCase,
  TestJobRulesUseCase,
  GetMarketInsightsUseCase,
  SendWeeklyDigestUseCase,
];

@Module({
  imports: [InfraModule],
  providers: [
    JobRuleEngine,
    { provide: CAPTURE_SCHEDULE, useClass: CronCaptureSchedule },
    ...USE_CASES,
    CaptureCoordinator,
    JobCronScheduler,
    WeeklyDigestScheduler,
  ],
  exports: [...USE_CASES, CaptureCoordinator],
})
export class ApplicationModule {}
