import type { CalendarRange } from '@/domain/services/brasilia-calendar';

export const SENIORITY_METRICS_REPOSITORY = Symbol.for('SENIORITY_METRICS_REPOSITORY');

/**
 * Um nivel de senioridade traduzido em termos de busca no titulo.
 *
 * `outranked` carrega os termos dos niveis mais altos: a vaga que casa com eles
 * ja foi contada la em cima, e e o que mantem a distribuicao somando o total.
 */
export interface TitleSeniorityBucket {
  readonly id: string;
  readonly keywords: readonly string[];
  readonly outranked: readonly string[];
}

export interface SeniorityBucketCount {
  readonly id: string;
  readonly total: number;
}

/**
 * Contrato de leitura da distribuicao por senioridade (ISP): conta vagas pela
 * DATA DE CAPTURA, que e outra pergunta da feita pelos KPIs (data de publicacao).
 */
export interface ISeniorityMetricsRepository {
  /** Todas as vagas capturadas no intervalo, inclusive as sem nivel no titulo. */
  countCapturedJobs(range: CalendarRange): Promise<number>;
  /** Uma contagem por nivel, sem contar duas vezes a vaga que cita dois. */
  countCapturedByTitleBucket(
    range: CalendarRange,
    buckets: readonly TitleSeniorityBucket[],
  ): Promise<SeniorityBucketCount[]>;
}
