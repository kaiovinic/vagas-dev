export const CAPTURE_LOG_REPOSITORY = Symbol.for('CAPTURE_LOG_REPOSITORY');

export const CAPTURE_STATUSES = ['RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED'] as const;

export type CaptureStatus = (typeof CAPTURE_STATUSES)[number];

export interface StartCaptureInput {
  readonly startedAt: Date;
  readonly nextRunAt: Date;
}

export interface FinishCaptureInput {
  readonly captureId: string;
  readonly finishedAt: Date;
  readonly status: CaptureStatus;
  readonly totalFound: number;
  readonly totalApproved: number;
  readonly totalRejected: number;
  readonly totalDuplicated: number;
  readonly totalPersisted: number;
  readonly failedSources: readonly string[];
  readonly errorMessage?: string;
}

/** Ultima execucao, usada no cabecalho de status do dashboard. */
export interface LastCaptureSnapshot {
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
  readonly nextRunAt: Date | null;
  readonly status: CaptureStatus;
  readonly totalPersisted: number;
  readonly failedSources: readonly string[];
}

export interface ICaptureLogRepository {
  /** Abre o log com status RUNNING e devolve o identificador da execucao. */
  start(input: StartCaptureInput): Promise<string>;
  finish(input: FinishCaptureInput): Promise<void>;
  findLastFinished(): Promise<LastCaptureSnapshot | null>;
}
