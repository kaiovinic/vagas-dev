import { Inject, Injectable } from '@nestjs/common';

import {
  CAPTURE_LOG_REPOSITORY,
  type CaptureStatus,
  type ICaptureLogRepository,
} from '@/domain/repositories/capture-log-repository';
import {
  DASHBOARD_METRICS_REPOSITORY,
  type IDashboardMetricsRepository,
} from '@/domain/repositories/dashboard-metrics-repository';
import { PUBLICATION_WINDOW_IN_HOURS } from '@/domain/services/job-rule-engine';

export interface CaptureStatusHeader {
  readonly lastCaptureAt: Date | null;
  readonly nextCaptureAt: Date | null;
  readonly status: CaptureStatus | null;
  readonly failedSources: readonly string[];
}

export interface DashboardSummary {
  readonly windowInHours: number;
  readonly capture: CaptureStatusHeader;
  readonly openJobs: { readonly total: number };
  readonly newInLast24h: {
    readonly total: number;
    readonly previousTotal: number;
    readonly delta: number;
  };
  readonly remote: { readonly total: number; readonly percentage: number };
  readonly hiringCompanies: { readonly total: number };
}

/** Monta os 4 KPIs do dashboard e o cabecalho de ultima/proxima captura. */
@Injectable()
export class GetDashboardSummaryUseCase {
  constructor(
    @Inject(DASHBOARD_METRICS_REPOSITORY)
    private readonly metrics: IDashboardMetricsRepository,
    @Inject(CAPTURE_LOG_REPOSITORY)
    private readonly captureLogs: ICaptureLogRepository,
  ) {}

  async execute(reference: Date = new Date()): Promise<DashboardSummary> {
    const [summary, lastCapture] = await Promise.all([
      this.metrics.getOpenJobsSummary(reference),
      this.captureLogs.findLastFinished(),
    ]);

    return {
      windowInHours: PUBLICATION_WINDOW_IN_HOURS,
      capture: {
        lastCaptureAt: lastCapture?.finishedAt ?? null,
        nextCaptureAt: lastCapture?.nextRunAt ?? null,
        status: lastCapture?.status ?? null,
        failedSources: lastCapture?.failedSources ?? [],
      },
      openJobs: { total: summary.openJobs },
      newInLast24h: {
        total: summary.newInLast24h,
        previousTotal: summary.newInPrevious24h,
        delta: summary.newInLast24h - summary.newInPrevious24h,
      },
      remote: {
        total: summary.remoteJobs,
        percentage: toPercentage(summary.remoteJobs, summary.openJobs),
      },
      hiringCompanies: { total: summary.hiringCompanies },
    };
  }
}

export function toPercentage(part: number, total: number): number {
  if (total === 0) {
    return 0;
  }

  return Math.round((part / total) * 1000) / 10;
}
