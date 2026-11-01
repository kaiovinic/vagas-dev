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

/** Um bloco de 2 horas da volumetria de captura das ultimas 24h. */
export interface CaptureBucketCount {
  /** Instante exato em que o bloco comeca. */
  readonly start: Date;
  /** Hora de inicio do bloco no horario de Brasilia, no formato `HH:mm`. */
  readonly label: string;
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
  /**
   * Volumetria de ingestao das ultimas 24h em 12 blocos de 2 horas, sempre os 12,
   * em ordem cronologica. Bloco sem captura vem com `total: 0` em vez de faltar:
   * um buraco no grafico esconderia justamente o ciclo que nao trouxe nada.
   */
  findCapturesTimeline24h(reference: Date): Promise<CaptureBucketCount[]>;
}
