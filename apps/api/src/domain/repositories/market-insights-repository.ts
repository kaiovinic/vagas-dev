import type { JobWorkModel } from '@/domain/entities/job';
import type { JobScope } from '@/domain/services/job-scope';

export const MARKET_INSIGHTS_REPOSITORY = Symbol.for('MARKET_INSIGHTS_REPOSITORY');

/** Onde procurar os termos do grupo: so no titulo ou tambem na descricao e tags. */
export type KeywordScope = 'TITLE' | 'TEXT';

export interface KeywordBucket {
  readonly id: string;
  readonly label: string;
  readonly keywords: readonly string[];
  readonly scope: KeywordScope;
}

export interface BucketCount {
  readonly id: string;
  readonly label: string;
  readonly total: number;
}

export interface ScopeCount {
  readonly scope: JobScope;
  readonly total: number;
}

export interface WorkModelCount {
  readonly workModel: JobWorkModel;
  readonly total: number;
}

/**
 * Contrato de leitura da aba `Mercado` (ISP): agregados de tendencia, separados
 * das metricas do cabecalho e da listagem.
 */
export interface IMarketInsightsRepository {
  countOpenJobs(reference: Date): Promise<number>;
  countByWorkModel(reference: Date): Promise<WorkModelCount[]>;
  /** Divisao entre mercado nacional e internacional. */
  countByScope(reference: Date): Promise<ScopeCount[]>;
  /** Uma contagem por grupo de termos; a vaga entra no grupo se casar com qualquer um. */
  countByKeywordBuckets(
    reference: Date,
    buckets: readonly KeywordBucket[],
  ): Promise<BucketCount[]>;
}
