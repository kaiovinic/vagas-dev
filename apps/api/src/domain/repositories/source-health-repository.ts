export const SOURCE_HEALTH_WRITER = Symbol.for('SOURCE_HEALTH_WRITER');
export const SOURCE_HEALTH_REPOSITORY = Symbol.for('SOURCE_HEALTH_REPOSITORY');
export const SOURCE_LAST_RUN_READER = Symbol.for('SOURCE_LAST_RUN_READER');

/** O que uma fonte produziu numa captura. */
export interface SourceRunRecord {
  readonly captureId: string;
  readonly source: string;
  readonly totalFound: number;
  readonly failed: boolean;
  readonly errorMessage?: string | undefined;
}

export interface SourceHealth {
  readonly source: string;
  readonly lastRunAt: Date | null;
  /** `false` quando a ULTIMA execucao falhou — o estado agora, nao a media. */
  readonly ok: boolean;
  readonly runsInWindow: number;
  readonly failuresInWindow: number;
  /** Vagas lidas da fonte, antes de qualquer filtro. */
  readonly totalFoundInWindow: number;
}

/** Escrita (ISP): so a captura registra o que cada fonte produziu. */
export interface ISourceHealthWriter {
  record(entries: readonly SourceRunRecord[]): Promise<void>;
}

/**
 * Leitura (ISP): so o dashboard consulta a saude. Separado da escrita porque
 * quem monta a tabela nao tem o que gravar.
 */
export interface ISourceHealthRepository {
  summarize(reference: Date, windowInHours: number): Promise<SourceHealth[]>;
}

/**
 * Leitura minima (ISP): quando a fonte rodou pela ultima vez.
 *
 * Interface propria, e nao mais um metodo em `ISourceHealthRepository`, porque
 * quem usa isto e um coletor decidindo se ja pode gastar cota — ele nao tem o
 * que fazer com o resto do resumo da saude.
 */
export interface ISourceLastRunReader {
  getLastRunAt(source: string): Promise<Date | null>;
}
