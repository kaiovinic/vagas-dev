export const DASHBOARD_METRICS_REPOSITORY = Symbol.for('DASHBOARD_METRICS_REPOSITORY');

export interface SourceJobCount {
  readonly source: string;
  readonly total: number;
}

export interface DailySourceJobCount {
  /** Dia da publicacao no formato `YYYY-MM-DD`, no horario de Brasilia. */
  readonly day: string;
  readonly source: string;
  readonly total: number;
}

export interface OpenJobsSummary {
  readonly openJobs: number;
  readonly newInLast24h: number;
  readonly newInPrevious24h: number;
  readonly remoteJobs: number;
  readonly hiringCompanies: number;
}

/**
 * Contrato de leitura do dashboard (ISP): nao expoe nenhuma escrita de captura.
 */
export interface IDashboardMetricsRepository {
  /** KPIs do cabecalho, todos dentro da janela de 72h. */
  getOpenJobsSummary(reference: Date): Promise<OpenJobsSummary>;
  /** Grafico de rosca: vagas abertas das ultimas 72h por fonte. */
  countOpenJobsBySource(reference: Date): Promise<SourceJobCount[]>;
  /** Grafico de barras empilhadas: vagas novas por dia de publicacao, por fonte. */
  countJobsByDayAndSource(reference: Date, days: number): Promise<DailySourceJobCount[]>;
}
