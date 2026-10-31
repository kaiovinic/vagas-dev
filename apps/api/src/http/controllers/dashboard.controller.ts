import {
  GetSourceHealthUseCase,
  type SourceHealthOutput,
} from '@/application/use-cases/get-source-health.use-case';
import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';

import {
  DEFAULT_CHART_DAYS,
  GetDashboardChartsUseCase,
  MAX_CHART_DAYS,
  type DashboardCharts,
} from '@/application/use-cases/get-dashboard-charts.use-case';
import {
  GetDashboardSummaryUseCase,
  type DashboardSummary,
} from '@/application/use-cases/get-dashboard-summary.use-case';
import { parseWithSchema } from '@/http/validation/parse-with-schema';

const chartsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(MAX_CHART_DAYS).default(DEFAULT_CHART_DAYS),
});

@Controller('api/dashboard')
export class DashboardController {
  constructor(
    private readonly summary: GetDashboardSummaryUseCase,
    private readonly charts: GetDashboardChartsUseCase,
    private readonly sourceHealth: GetSourceHealthUseCase,
  ) {}

  /** KPIs das ultimas 72h + horarios da ultima e da proxima captura. */
  @Get('summary')
  async getSummary(): Promise<DashboardSummary> {
    return this.summary.execute();
  }

  /** Dados do grafico de rosca por fonte e das barras empilhadas por dia. */
  @Get('charts')
  async getCharts(@Query() query: unknown): Promise<DashboardCharts> {
    const { days } = parseWithSchema(chartsQuerySchema, query);

    return this.charts.execute(days);
  }

  /** Aba `Dashboard`: estado de cada coletor nas ultimas 24h. */
  @Get('sources-health')
  async getSourceHealth(): Promise<SourceHealthOutput> {
    return this.sourceHealth.execute();
  }
}
