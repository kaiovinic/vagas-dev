import { Injectable, Logger } from '@nestjs/common';

import {
  RunJobCollectionUseCase,
  type CaptureReport,
} from '@/application/use-cases/run-job-collection.use-case';

export interface CaptureRunOutcome {
  readonly report: CaptureReport;
  /**
   * `true` quando ja havia uma captura em andamento e esta chamada apenas
   * aguardou o resultado dela, em vez de abrir uma nova.
   */
  readonly joinedRunning: boolean;
}

/**
 * Porta unica de entrada das capturas: o cron e o botao manual passam por aqui.
 *
 * Mantem uma execucao por vez (single-flight). Sem isso, clicar duas vezes no
 * botao — ou clicar no exato minuto do cron — dispararia duas varreduras
 * simultaneas nas mesmas cinco fontes, dobrando o risco de bloqueio por excesso
 * de requisicoes (a ProgramaThor ja devolveu 429 uma vez).
 */
@Injectable()
export class CaptureCoordinator {
  private readonly logger = new Logger(CaptureCoordinator.name);

  private running: Promise<CaptureReport> | null = null;

  get isRunning(): boolean {
    return this.running !== null;
  }

  constructor(private readonly runJobCollection: RunJobCollectionUseCase) {}

  async run(): Promise<CaptureRunOutcome> {
    const inFlight = this.running;

    if (inFlight !== null) {
      this.logger.log('Captura ja em andamento: aguardando a que esta rodando');

      return { report: await inFlight, joinedRunning: true };
    }

    const started = this.runJobCollection.execute().finally(() => {
      this.running = null;
    });

    this.running = started;

    return { report: await started, joinedRunning: false };
  }
}
