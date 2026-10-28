import type { RawJobProps } from '@/domain/dtos/raw-job-props';

/**
 * Token de multi-provider. Novos coletores sao registrados neste token e o
 * orquestrador nao precisa ser alterado (OCP).
 */
export const JOB_SCRAPERS = Symbol.for('JOB_SCRAPERS');

/**
 * Contrato de um coletor de vagas.
 *
 * Toda implementacao deve ser substituivel (LSP): nunca lanca excecao para fora,
 * devolvendo lista vazia quando a fonte falha ou muda de layout.
 */
export interface IJobScraperProvider {
  /** Identificador da fonte, usado em `Job.source` e nos graficos por fonte. */
  readonly source: string;

  /** Rotulo legivel da fonte para o dashboard. */
  readonly label: string;

  scrape(): Promise<RawJobProps[]>;
}
