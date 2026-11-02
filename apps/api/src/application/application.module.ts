import { Module } from '@nestjs/common';

import { JobRuleEngine } from '@/domain/services/job-rule-engine';
import { CAPTURE_SCHEDULE } from '@/domain/providers/capture-schedule';
import { CronCaptureSchedule } from '@/application/schedulers/cron-capture-schedule';
import { CaptureCoordinator } from '@/application/services/capture-coordinator.service';
import { AlertDispatchScheduler } from '@/application/schedulers/alert-dispatch.scheduler';
import { JobCronScheduler } from '@/application/schedulers/job-cron.scheduler';
import { WeeklyDigestScheduler } from '@/application/schedulers/weekly-digest.scheduler';
import { CloseFinishedJobsUseCase } from '@/application/use-cases/close-finished-jobs.use-case';
import { DispatchPendingAlertsUseCase } from '@/application/use-cases/dispatch-pending-alerts.use-case';
import { FillMissingDescriptionsUseCase } from '@/application/use-cases/fill-missing-descriptions.use-case';
import { GetMarketInsightsUseCase } from '@/application/use-cases/get-market-insights.use-case';
import { GetSourceHealthUseCase } from '@/application/use-cases/get-source-health.use-case';
import { GetCandidateProfileUseCase } from '@/application/use-cases/get-candidate-profile.use-case';
import { SaveCandidateProfileUseCase } from '@/application/use-cases/save-candidate-profile.use-case';
import { GenerateResumeUseCase } from '@/application/use-cases/generate-resume.use-case';
import { GetDashboardChartsUseCase } from '@/application/use-cases/get-dashboard-charts.use-case';
import { GetDashboardSummaryUseCase } from '@/application/use-cases/get-dashboard-summary.use-case';
import { ListJobsUseCase } from '@/application/use-cases/list-jobs.use-case';
import { RunJobCollectionUseCase } from '@/application/use-cases/run-job-collection.use-case';
import { SendWeeklyDigestUseCase } from '@/application/use-cases/send-weekly-digest.use-case';
import { TestJobRulesUseCase } from '@/application/use-cases/test-job-rules.use-case';
import { InfraModule } from '@/infra/infra.module';

const USE_CASES = [
  RunJobCollectionUseCase,
  CloseFinishedJobsUseCase,
  DispatchPendingAlertsUseCase,
  FillMissingDescriptionsUseCase,
  GetDashboardSummaryUseCase,
  GetDashboardChartsUseCase,
  ListJobsUseCase,
  TestJobRulesUseCase,
  GetMarketInsightsUseCase,
  SendWeeklyDigestUseCase,
  GetSourceHealthUseCase,
  GetCandidateProfileUseCase,
  SaveCandidateProfileUseCase,
  GenerateResumeUseCase,
];

@Module({
  imports: [InfraModule],
  providers: [
    JobRuleEngine,
    { provide: CAPTURE_SCHEDULE, useClass: CronCaptureSchedule },
    ...USE_CASES,
    CaptureCoordinator,
    JobCronScheduler,
    AlertDispatchScheduler,
    WeeklyDigestScheduler,
  ],
  exports: [...USE_CASES, CaptureCoordinator],
})
export class ApplicationModule {}
