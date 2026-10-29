import { Inject, Injectable } from '@nestjs/common';

import type { JobWorkModel } from '@/domain/entities/job';
import {
  MARKET_INSIGHTS_REPOSITORY,
  type IMarketInsightsRepository,
  type KeywordBucket,
} from '@/domain/repositories/market-insights-repository';
import type { JobScope } from '@/domain/services/job-scope';
import { STACK_KEYWORDS } from '@/domain/services/job-rule-catalog';
import { PUBLICATION_WINDOW_IN_HOURS } from '@/domain/services/job-rule-engine';
import {
  JOB_SENIORITY_LEVELS,
  seniorityKeywords,
  seniorityLabel,
} from '@/domain/services/job-seniority';
import { toPercentage } from '@/application/use-cases/get-dashboard-summary.use-case';

const SCOPE_LABELS: Readonly<Record<JobScope, string>> = {
  NATIONAL: 'Nacionais',
  INTERNATIONAL: 'Internacionais',
  UNKNOWN: 'Nao identificado',
};

const WORK_MODEL_LABELS: Readonly<Record<JobWorkModel, string>> = {
  REMOTE: 'Remoto',
  HYBRID: 'Hibrido',
  ONSITE: 'Presencial',
  UNKNOWN: 'Nao informada',
};

export interface MarketSlice {
  readonly id: string;
  readonly label: string;
  readonly total: number;
  /** Percentual sobre o total de vagas abertas, nao sobre a soma das fatias. */
  readonly percentage: number;
}

export interface MarketInsights {
  readonly windowInHours: number;
  readonly openJobs: number;
  /** Stacks mais pedidas; uma vaga pode entrar em mais de uma. */
  readonly technologies: readonly MarketSlice[];
  readonly seniorities: readonly MarketSlice[];
  readonly workModels: readonly MarketSlice[];
  /** Divisao entre mercado nacional e internacional. */
  readonly scopes: readonly MarketSlice[];
  /** Vagas que nao declaram nivel no titulo. */
  readonly seniorityNotInformed: MarketSlice;
}

@Injectable()
export class GetMarketInsightsUseCase {
  constructor(
    @Inject(MARKET_INSIGHTS_REPOSITORY)
    private readonly market: IMarketInsightsRepository,
  ) {}

  async execute(reference: Date = new Date()): Promise<MarketInsights> {
    const [openJobs, workModels, scopes, technologies, seniorities] = await Promise.all([
      this.market.countOpenJobs(reference),
      this.market.countByWorkModel(reference),
      this.market.countByScope(reference),
      this.market.countByKeywordBuckets(reference, technologyBuckets()),
      this.market.countByKeywordBuckets(reference, seniorityBuckets()),
    ]);

    const seniorityTotal = seniorities.reduce((total, bucket) => total + bucket.total, 0);

    return {
      windowInHours: PUBLICATION_WINDOW_IN_HOURS,
      openJobs,
      technologies: toSlices(technologies, openJobs),
      seniorities: toSlices(seniorities, openJobs),
      scopes: toSlices(
        scopes.map((row) => ({
          id: row.scope,
          label: SCOPE_LABELS[row.scope],
          total: row.total,
        })),
        openJobs,
      ),
      workModels: toSlices(
        workModels.map((row) => ({
          id: row.workModel,
          label: WORK_MODEL_LABELS[row.workModel],
          total: row.total,
        })),
        openJobs,
      ),
      // Uma vaga pode ter dois niveis no titulo ("Pleno/Senior"), entao o
      // restante nunca fica negativo.
      seniorityNotInformed: {
        id: 'UNKNOWN',
        label: 'Nao informado',
        total: Math.max(openJobs - seniorityTotal, 0),
        percentage: toPercentage(Math.max(openJobs - seniorityTotal, 0), openJobs),
      },
    };
  }
}

export function technologyBuckets(): KeywordBucket[] {
  return STACK_KEYWORDS.map((group) => ({
    id: group.label,
    label: group.label,
    keywords: group.aliases,
    scope: 'TEXT' as const,
  }));
}

function seniorityBuckets(): KeywordBucket[] {
  return JOB_SENIORITY_LEVELS.map((level) => ({
    id: level,
    label: seniorityLabel(level),
    keywords: seniorityKeywords(level),
    scope: 'TITLE' as const,
  }));
}

function toSlices(
  counts: readonly { id: string; label: string; total: number }[],
  openJobs: number,
): MarketSlice[] {
  return counts
    .filter((count) => count.total > 0)
    .map((count) => ({
      id: count.id,
      label: count.label,
      total: count.total,
      percentage: toPercentage(count.total, openJobs),
    }))
    .sort((first, second) => second.total - first.total);
}
