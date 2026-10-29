import type { BucketCount, KeywordBucket } from '@/domain/repositories/market-insights-repository';

export const WEEKLY_DIGEST_REPOSITORY = Symbol.for('WEEKLY_DIGEST_REPOSITORY');

export interface WeeklyDigestSnapshot {
  /** Vagas dentro da janela de 72h: o que esta aberto no radar agora. */
  readonly openJobs: number;
  /** Vagas publicadas nos ultimos 7 dias, a janela do resumo. */
  readonly newInPeriod: number;
  /** Recorte das abertas: 100% remotas. */
  readonly remoteJobs: number;
  /** Recorte das abertas: presenciais ou hibridas em Salvador e RMS. */
  readonly localJobs: number;
  /** Uma contagem por grupo de stack, na janela de 7 dias. */
  readonly technologies: readonly BucketCount[];
}

/**
 * Contrato de leitura do resumo semanal (ISP).
 *
 * Fica separado de `IDashboardMetricsRepository` e `IMarketInsightsRepository`
 * porque a janela e outra: o dashboard trabalha com as 72h de vaga aberta, e o
 * resumo precisa dos 7 dias corridos.
 */
export interface IWeeklyDigestRepository {
  summarize(
    reference: Date,
    periodInDays: number,
    buckets: readonly KeywordBucket[],
  ): Promise<WeeklyDigestSnapshot>;
}
