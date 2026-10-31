import { Inject, Injectable } from '@nestjs/common';

import {
  nextSourceRunAt,
  sourceIntervalInHours,
} from '@/domain/services/source-cadence';
import {
  SOURCE_HEALTH_REPOSITORY,
  type ISourceHealthRepository,
} from '@/domain/repositories/source-health-repository';

/** Janela da tabela: o que aconteceu no ultimo dia. */
export const SOURCE_HEALTH_WINDOW_IN_HOURS = 24;

export type SourceStatus = 'OK' | 'FAILING' | 'IDLE';

export interface SourceHealthRow {
  readonly source: string;
  readonly status: SourceStatus;
  readonly lastRunAt: string | null;
  readonly nextRunAt: string | null;
  readonly intervalInHours: number;
  readonly runs: number;
  readonly failures: number;
  readonly totalFound: number;
}

export interface SourceHealthOutput {
  readonly windowInHours: number;
  readonly sources: readonly SourceHealthRow[];
}

/**
 * Aba `Dashboard`: como cada coletor esta se saindo.
 *
 * Existe porque o contador de uma captura nao responde por fonte. Uma captura
 * `SUCCESS` com 430 vagas pode esconder um coletor que nao traz nada ha dias —
 * foi o que aconteceu com o Jobbol, que respondia 403 em silencio.
 */
@Injectable()
export class GetSourceHealthUseCase {
  constructor(
    @Inject(SOURCE_HEALTH_REPOSITORY)
    private readonly health: ISourceHealthRepository,
  ) {}

  async execute(reference: Date = new Date()): Promise<SourceHealthOutput> {
    const sources = await this.health.summarize(reference, SOURCE_HEALTH_WINDOW_IN_HOURS);

    return {
      windowInHours: SOURCE_HEALTH_WINDOW_IN_HOURS,
      sources: sources
        .map((entry) => ({
          source: entry.source,
          status: resolveStatus(entry.ok, entry.totalFoundInWindow, entry.runsInWindow),
          lastRunAt: entry.lastRunAt?.toISOString() ?? null,
          nextRunAt: nextSourceRunAt(entry.source, entry.lastRunAt)?.toISOString() ?? null,
          intervalInHours: sourceIntervalInHours(entry.source),
          runs: entry.runsInWindow,
          failures: entry.failuresInWindow,
          totalFound: entry.totalFoundInWindow,
        }))
        .sort((left, right) => right.totalFound - left.totalFound),
    };
  }
}

/**
 * Tres estados, e nao dois: uma fonte que responde mas nao traz nada ha um dia
 * nao esta "ok" — foi assim que o coletor do Jobbol passou despercebido. Mas
 * tambem nao esta falhando, e chamar de falha faria o alerta perder o sentido.
 */
function resolveStatus(ok: boolean, totalFound: number, runs: number): SourceStatus {
  if (!ok) {
    return 'FAILING';
  }

  return runs > 0 && totalFound === 0 ? 'IDLE' : 'OK';
}
