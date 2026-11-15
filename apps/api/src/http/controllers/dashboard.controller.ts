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
import {
  GetSeniorityDistributionUseCase,
  SENIORITY_FILTER_VALUES,
  type SeniorityDistribution,
} from '@/application/use-cases/get-seniority-distribution.use-case';
import { daysInMonth } from '@/domain/services/brasilia-calendar';
import { parseWithSchema } from '@/http/validation/parse-with-schema';

const chartsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(MAX_CHART_DAYS).default(DEFAULT_CHART_DAYS),
});

/** Anos aceitos no seletor: antes disto o radar nao existia. */
const MIN_YEAR = 2020;
const MAX_YEAR = 2100;

/**
 * `seniority` chega uma vez por nivel marcado (`?seniority=MID&seniority=SENIOR`)
 * e o Express entrega string quando vem so um. Os dois formatos viram lista.
 */
const seniorityFilterSchema = z
  .union([z.enum(SENIORITY_FILTER_VALUES), z.array(z.enum(SENIORITY_FILTER_VALUES))])
  .optional()
  .transform((value) => (value === undefined ? undefined : [value].flat()));

const seniorityQuerySchema = z
  .object({
    year: z.coerce.number().int().min(MIN_YEAR).max(MAX_YEAR).optional(),
    month: z.coerce.number().int().min(1).max(12).optional(),
    day: z.coerce.number().int().min(1).max(31).optional(),
    seniority: seniorityFilterSchema,
  })
  .superRefine((query, context) => {
    if (query.day === undefined) {
      return;
    }

    if (query.month === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['day'],
        message: 'Informe o mes para filtrar por dia',
      });

      return;
    }

    // Sem esta checagem, 31 de fevereiro viraria 3 de marco no `Date.UTC` e o
    // grafico responderia sobre um dia que o usuario nem escolheu.
    const limit = daysInMonth(query.year ?? new Date().getUTCFullYear(), query.month);

    if (query.day > limit) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['day'],
        message: `O mes informado tem apenas ${limit} dias`,
      });
    }
  });

@Controller('api/dashboard')
export class DashboardController {
  constructor(
    private readonly summary: GetDashboardSummaryUseCase,
    private readonly charts: GetDashboardChartsUseCase,
    private readonly sourceHealth: GetSourceHealthUseCase,
    private readonly seniority: GetSeniorityDistributionUseCase,
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

  /** Distribuicao por senioridade das vagas capturadas no recorte escolhido. */
  @Get('seniority')
  async getSeniority(@Query() query: unknown): Promise<SeniorityDistribution> {
    const { year, month, day, seniority } = parseWithSchema(seniorityQuerySchema, query);

    return this.seniority.execute({ year, month, day, seniorities: seniority });
  }

  /** Aba `Dashboard`: estado de cada coletor nas ultimas 24h. */
  @Get('sources-health')
  async getSourceHealth(): Promise<SourceHealthOutput> {
    return this.sourceHealth.execute();
  }
}
