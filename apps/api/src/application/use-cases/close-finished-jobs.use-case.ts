import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  JOB_CLOSURE_PROVIDERS,
  type IJobClosureProvider,
} from '@/domain/providers/job-closure-provider';
import {
  JOB_CLOSURE_WRITER,
  type IJobClosureWriter,
} from '@/domain/repositories/job-closure-repository';

export interface ClosedJobsReport {
  /** Vagas que mudaram de aberta para encerrada neste ciclo. */
  readonly totalClosed: number;
  readonly failedSources: readonly string[];
}

/**
 * Encerra as vagas que as fontes declararam acabadas.
 *
 * Roda depois da coleta, no mesmo ciclo. Sem isso, uma issue fechada no GitHub
 * continuava no feed ate envelhecer as 72 horas: a vaga simplesmente parava de
 * aparecer na listagem da fonte, e nada no radar interpretava esse silencio.
 *
 * Depende so das abstracoes `IJobClosureProvider` e `IJobClosureWriter` (DIP) e
 * nao conhece o GitHub.
 */
@Injectable()
export class CloseFinishedJobsUseCase {
  private readonly logger = new Logger(CloseFinishedJobsUseCase.name);

  constructor(
    @Inject(JOB_CLOSURE_PROVIDERS) private readonly providers: readonly IJobClosureProvider[],
    @Inject(JOB_CLOSURE_WRITER) private readonly jobs: IJobClosureWriter,
  ) {}

  async execute(reference: Date = new Date()): Promise<ClosedJobsReport> {
    const { urls, failedSources } = await this.collectClosedUrls();

    if (urls.length === 0) {
      return { totalClosed: 0, failedSources };
    }

    const totalClosed = await this.jobs.closeByUrl(urls, reference);

    if (totalClosed > 0) {
      this.logger.log(`${totalClosed} vaga(s) encerrada(s) na fonte sairam do feed`);
    }

    return { totalClosed, failedSources };
  }

  /** Uma fonte que falha ao listar encerramentos nao impede as demais. */
  private async collectClosedUrls(): Promise<{
    readonly urls: string[];
    readonly failedSources: string[];
  }> {
    const results = await Promise.all(this.providers.map((provider) => this.listOf(provider)));

    const urls = new Set<string>();
    const failedSources: string[] = [];

    for (const result of results) {
      if (result.failed) {
        failedSources.push(result.source);

        continue;
      }

      for (const url of result.urls) {
        urls.add(url);
      }
    }

    return { urls: [...urls], failedSources };
  }

  /** O erro da fonte morre aqui: quem chama recebe uma lista vazia e o aviso. */
  private async listOf(provider: IJobClosureProvider): Promise<SourceClosures> {
    try {
      return { source: provider.source, urls: await provider.findClosedJobUrls(), failed: false };
    } catch (error) {
      this.logger.warn(`Encerramentos de ${provider.source}: ${describeError(error)}`);

      return { source: provider.source, urls: [], failed: true };
    }
  }
}

interface SourceClosures {
  readonly source: string;
  readonly urls: readonly string[];
  readonly failed: boolean;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
