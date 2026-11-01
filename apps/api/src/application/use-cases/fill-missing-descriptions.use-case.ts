import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  JOB_DESCRIPTION_FETCHERS,
  type IJobDescriptionFetcher,
} from '@/domain/providers/job-description-fetcher';
import { PUBLICATION_WINDOW_IN_HOURS } from '@/domain/services/job-rule-engine';
import {
  JOB_DESCRIPTION_WRITER,
  MISSING_DESCRIPTION_REPOSITORY,
  type IJobDescriptionWriter,
  type IMissingDescriptionRepository,
} from '@/domain/repositories/job-description-repository';

export interface FilledDescriptionsReport {
  /** Vagas que estavam sem descricao e passaram a ter. */
  readonly totalFilled: number;
  readonly failedSources: readonly string[];
}

/**
 * Teto de vagas consertadas por ciclo.
 *
 * Uma requisicao cada, no ritmo do proprio coletor. Vinte cobre de sobra o que
 * aparece numa captura normal (sao nove vagas acumuladas de semanas) e impede
 * que um residuo grande vire uma rajada.
 */
export const MAX_DESCRIPTIONS_FILLED_PER_CYCLE = 20;

/**
 * Volta nas vagas que ficaram sem descricao e busca o detalhe delas pela url.
 *
 * Roda depois da coleta. A fila da coleta cobre os primeiros cards de cada
 * busca, e o conjunto que a fonte devolve gira: medido em producao, nove vagas
 * gravadas sem descricao seguiram vazias por tres ciclos, com 121 descricoes
 * em cache e 108 cards lidos por ciclo. Elas apareciam no feed com o aviso de
 * "fonte nao publica a descricao", que era falso.
 *
 * O texto buscado vai para a vaga E para o cache, para que o card, quando
 * reaparecer na busca, nao custe outra requisicao.
 */
@Injectable()
export class FillMissingDescriptionsUseCase {
  private readonly logger = new Logger(FillMissingDescriptionsUseCase.name);

  constructor(
    @Inject(JOB_DESCRIPTION_FETCHERS) private readonly fetchers: readonly IJobDescriptionFetcher[],
    @Inject(MISSING_DESCRIPTION_REPOSITORY) private readonly jobs: IMissingDescriptionRepository,
    @Inject(JOB_DESCRIPTION_WRITER) private readonly cache: IJobDescriptionWriter,
  ) {}

  async execute(
    reference: Date = new Date(),
    limit: number = MAX_DESCRIPTIONS_FILLED_PER_CYCLE,
  ): Promise<FilledDescriptionsReport> {
    const publishedAfter = windowStart(reference);
    let totalFilled = 0;
    const failedSources: string[] = [];

    for (const fetcher of this.fetchers) {
      const report = await this.fillFor(fetcher, publishedAfter, limit);

      totalFilled += report.filled;

      if (report.failed) {
        failedSources.push(fetcher.source);
      }
    }

    if (totalFilled > 0) {
      this.logger.log(`${totalFilled} vaga(s) sem descricao foram completadas`);
    }

    return { totalFilled, failedSources };
  }

  /** Uma fonte que falha nao impede as demais, nem derruba a captura. */
  private async fillFor(
    fetcher: IJobDescriptionFetcher,
    publishedAfter: Date,
    limit: number,
  ): Promise<{ filled: number; failed: boolean }> {
    try {
      const urls = await this.jobs.findUrlsMissingDescription(
        fetcher.source,
        publishedAfter,
        limit,
      );
      let filled = 0;

      for (const url of urls) {
        filled += await this.fill(fetcher, url);
      }

      return { filled, failed: false };
    } catch (error: unknown) {
      this.logger.warn(`Descricoes faltantes de ${fetcher.source}: ${describeError(error)}`);

      return { filled: 0, failed: true };
    }
  }

  /** Vaga que a fonte nao descreve mais nao e erro: fica como esta. */
  private async fill(fetcher: IJobDescriptionFetcher, url: string): Promise<number> {
    const description = await fetcher.fetchDescriptionFor(url);

    if (description.length === 0) {
      return 0;
    }

    const filled = await this.jobs.fillDescriptionByUrl(url, description);
    await this.cache.saveDescriptions([{ url, description }]);

    return filled;
  }
}

/**
 * Mesma janela do feed: o conserto existe para o que o painel exibe, e a regra
 * de 72h e do dominio, nao deste caso de uso.
 */
function windowStart(reference: Date): Date {
  return new Date(reference.getTime() - PUBLICATION_WINDOW_IN_HOURS * 60 * 60 * 1000);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
