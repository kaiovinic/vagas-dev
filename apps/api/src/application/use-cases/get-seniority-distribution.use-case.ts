import { Inject, Injectable } from '@nestjs/common';

import {
  SENIORITY_METRICS_REPOSITORY,
  type ISeniorityMetricsRepository,
  type TitleSeniorityBucket,
} from '@/domain/repositories/seniority-metrics-repository';
import {
  BRASILIA_TIME_ZONE,
  brasiliaCalendarRange,
  currentBrasiliaYear,
} from '@/domain/services/brasilia-calendar';
import {
  JOB_SENIORITY_LEVELS,
  keywordsAboveSeniority,
  seniorityKeywords,
  seniorityLabel,
} from '@/domain/services/job-seniority';
import { toPercentage } from '@/application/use-cases/get-dashboard-summary.use-case';

/** Nivel das vagas cujo titulo nao informa senioridade nenhuma. */
export const UNSPECIFIED_SENIORITY = 'UNSPECIFIED';

export const UNSPECIFIED_SENIORITY_LABEL = 'Nao especificado';

/** Valores aceitos no filtro: os niveis do dominio mais o "nao especificado". */
export const SENIORITY_FILTER_VALUES = [
  ...JOB_SENIORITY_LEVELS,
  UNSPECIFIED_SENIORITY,
] as const;

export interface SeniorityDistributionInput {
  readonly year?: number | undefined;
  /** `undefined` significa o ano inteiro, nao "janeiro". */
  readonly month?: number | undefined;
  /** `undefined` significa o mes inteiro, nao "dia 1". */
  readonly day?: number | undefined;
  /** Vazio significa todos os niveis; nivel desconhecido e ignorado. */
  readonly seniorities?: readonly string[] | undefined;
}

export interface SenioritySlice {
  readonly id: string;
  readonly label: string;
  readonly total: number;
  /** Percentual sobre TODAS as vagas capturadas no periodo, nao sobre o filtro. */
  readonly percentage: number;
}

export interface SeniorityDistribution {
  readonly year: number;
  readonly month: number | null;
  readonly day: number | null;
  readonly timeZone: string;
  readonly start: Date;
  readonly end: Date;
  /** Vagas capturadas no periodo, com ou sem nivel no titulo. */
  readonly total: number;
  /** Soma apenas dos niveis que sobraram no filtro. */
  readonly filteredTotal: number;
  readonly levels: readonly SenioritySlice[];
}

/**
 * Distribuicao por senioridade das vagas CAPTURADAS no periodo escolhido.
 *
 * O recorte e a data de captura, e nao a de publicacao: a pergunta que o grafico
 * responde e "que nivel o radar trouxe", e uma vaga publicada ha meses so entra
 * no painel no dia em que foi colhida.
 */
@Injectable()
export class GetSeniorityDistributionUseCase {
  constructor(
    @Inject(SENIORITY_METRICS_REPOSITORY)
    private readonly metrics: ISeniorityMetricsRepository,
  ) {}

  async execute(
    input: SeniorityDistributionInput = {},
    reference: Date = new Date(),
  ): Promise<SeniorityDistribution> {
    const year = input.year ?? currentBrasiliaYear(reference);
    const month = input.month ?? null;
    const day = input.day ?? null;
    const range = brasiliaCalendarRange({ year, month, day });

    const [total, counts] = await Promise.all([
      this.metrics.countCapturedJobs(range),
      this.metrics.countCapturedByTitleBucket(range, seniorityBuckets()),
    ]);

    const byLevel = new Map(counts.map((count) => [count.id, count.total]));
    const classified = counts.reduce((sum, count) => sum + count.total, 0);
    const selected = normalizeFilter(input.seniorities);
    const levels = allSlices(byLevel, Math.max(total - classified, 0))
      .filter((slice) => selected.size === 0 || selected.has(slice.id))
      .map((slice) => ({ ...slice, percentage: toPercentage(slice.total, total) }));

    return {
      year,
      month,
      day,
      timeZone: BRASILIA_TIME_ZONE,
      start: range.start,
      end: range.end,
      total,
      filteredTotal: levels.reduce((sum, slice) => sum + slice.total, 0),
      levels,
    };
  }
}

/** Os niveis do dominio, cada um com os termos dos superiores para excluir. */
function seniorityBuckets(): TitleSeniorityBucket[] {
  return JOB_SENIORITY_LEVELS.map((level) => ({
    id: level,
    keywords: seniorityKeywords(level),
    outranked: keywordsAboveSeniority(level),
  }));
}

/** Ordem fixa: do estagio ao lead, com o nao especificado sempre no fim. */
function allSlices(
  byLevel: ReadonlyMap<string, number>,
  unspecified: number,
): Omit<SenioritySlice, 'percentage'>[] {
  return [
    ...JOB_SENIORITY_LEVELS.map((level) => ({
      id: level,
      label: seniorityLabel(level),
      total: byLevel.get(level) ?? 0,
    })),
    { id: UNSPECIFIED_SENIORITY, label: UNSPECIFIED_SENIORITY_LABEL, total: unspecified },
  ];
}

function normalizeFilter(seniorities: readonly string[] | undefined): ReadonlySet<string> {
  const known = (seniorities ?? []).filter((value) =>
    SENIORITY_FILTER_VALUES.some((allowed) => allowed === value),
  );

  return new Set(known);
}
