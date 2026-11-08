import { Inject, Injectable } from '@nestjs/common';

import {
  JOB_SCRAPERS,
  type IJobScraperProvider,
} from '@/domain/providers/job-scraper-provider';
import {
  nextSourceRunAt,
  sourceIntervalInHours,
} from '@/domain/services/source-cadence';
import {
  SOURCE_HEALTH_REPOSITORY,
  type ISourceHealthRepository,
  type SourceHealth,
} from '@/domain/repositories/source-health-repository';

/** Janela da tabela: o que aconteceu no ultimo dia. */
export const SOURCE_HEALTH_WINDOW_IN_HOURS = 24;

/**
 * Cinco estados, em ordem de gravidade.
 *
 * - `UNCONFIGURED` falta credencial ou endereco: a fonte nao vai rodar hoje nem
 *                  amanha, e nenhum outro numero da linha importa.
 * - `FAILING`      a ultima execucao falhou.
 * - `INACTIVE`     passou da hora e nao rodou. Nao e falha: ninguem a visitou.
 * - `IDLE`         rodou e nao trouxe nada.
 * - `OK`           rodou e trouxe vaga.
 */
export type SourceStatus = 'OK' | 'FAILING' | 'IDLE' | 'INACTIVE' | 'UNCONFIGURED';

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
 *
 * Le os coletores registrados, e nao apenas o historico do banco, por duas
 * razoes que vieram de um incidente real: fonte que nunca rodou nao tem linha
 * no `capture_source_logs` e simplesmente NAO APARECIA na tabela, e fonte sem
 * credencial aparecia verde — um `SERP_ENDPOINT` vazio no container tirou o
 * coletor de publicacoes do ar por cinco dias, e o painel nao disse nada. Quem
 * sabe se falta credencial e o proprio coletor; o banco so sabe do passado.
 */
@Injectable()
export class GetSourceHealthUseCase {
  constructor(
    @Inject(SOURCE_HEALTH_REPOSITORY)
    private readonly health: ISourceHealthRepository,
    @Inject(JOB_SCRAPERS)
    private readonly scrapers: readonly IJobScraperProvider[],
  ) {}

  async execute(reference: Date = new Date()): Promise<SourceHealthOutput> {
    const summarized = await this.health.summarize(reference, SOURCE_HEALTH_WINDOW_IN_HOURS);

    return {
      windowInHours: SOURCE_HEALTH_WINDOW_IN_HOURS,
      sources: this.withRegisteredSources(summarized)
        .map((entry) => this.toRow(entry, reference))
        .sort((left, right) => right.totalFound - left.totalFound),
    };
  }

  /**
   * Acrescenta o coletor registrado que o banco nao conhece.
   *
   * Sem isto, a fonte que nunca executou fica invisivel: a tabela e montada a
   * partir das execucoes, e quem nunca rodou nao tem nenhuma. Era o pior caso
   * possivel — a fonte mais quebrada de todas era a unica que nao aparecia.
   */
  private withRegisteredSources(summarized: readonly SourceHealth[]): SourceHealth[] {
    const known = new Set(summarized.map((entry) => entry.source));

    return [
      ...summarized,
      ...this.scrapers
        .filter((scraper) => !known.has(scraper.source))
        .map((scraper) => neverRan(scraper.source)),
    ];
  }

  private toRow(entry: SourceHealth, reference: Date): SourceHealthRow {
    const nextRunAt = nextSourceRunAt(entry.source, entry.lastRunAt);

    return {
      source: entry.source,
      status: this.resolveStatus(entry, nextRunAt, reference),
      lastRunAt: entry.lastRunAt?.toISOString() ?? null,
      nextRunAt: nextRunAt?.toISOString() ?? null,
      intervalInHours: sourceIntervalInHours(entry.source),
      runs: entry.runsInWindow,
      failures: entry.failuresInWindow,
      totalFound: entry.totalFoundInWindow,
    };
  }

  private resolveStatus(
    entry: SourceHealth,
    nextRunAt: Date | null,
    reference: Date,
  ): SourceStatus {
    if (!this.isConfigured(entry.source)) {
      return 'UNCONFIGURED';
    }

    if (!entry.ok) {
      return 'FAILING';
    }

    if (entry.runsInWindow === 0 && isOverdue(nextRunAt, reference)) {
      return 'INACTIVE';
    }

    return entry.runsInWindow > 0 && entry.totalFoundInWindow === 0 ? 'IDLE' : 'OK';
  }

  /**
   * Fonte que nao esta mais no registro conta como configurada.
   *
   * O historico guarda execucoes de coletores desligados — Jobbol, Solides,
   * Coodesh —, e marca-los como "sem credencial" seria mentir sobre o motivo.
   * Eles caem em `INACTIVE`, que e exatamente o que sao.
   */
  private isConfigured(source: string): boolean {
    const scraper = this.scrapers.find((candidate) => candidate.source === source);

    return scraper === undefined || scraper.isConfigured();
  }
}

/**
 * Sem `nextRunAt` nao ha como estar na hora: a fonte nunca rodou, e nunca
 * rodar e a forma mais grave de estar atrasada.
 */
function isOverdue(nextRunAt: Date | null, reference: Date): boolean {
  return nextRunAt === null || nextRunAt.getTime() <= reference.getTime();
}

function neverRan(source: string): SourceHealth {
  return {
    source,
    lastRunAt: null,
    ok: true,
    runsInWindow: 0,
    failuresInWindow: 0,
    totalFoundInWindow: 0,
  };
}
