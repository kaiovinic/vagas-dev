import { Controller, HttpCode, Post } from '@nestjs/common';

import { CaptureCoordinator } from '@/application/services/capture-coordinator.service';

export interface CaptureRunResponse {
  readonly captureId: string;
  readonly status: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly nextRunAt: string;
  readonly totalFound: number;
  readonly totalApproved: number;
  readonly totalPersisted: number;
  readonly totalDuplicated: number;
  readonly failedSources: readonly string[];
  /** `true` quando havia captura em andamento e esta chamada so aguardou o fim. */
  readonly joinedRunning: boolean;
}

@Controller('api/capture')
export class CaptureController {
  constructor(private readonly captures: CaptureCoordinator) {}

  /**
   * Dispara uma captura agora, sem esperar o cron de 2h.
   *
   * Responde 200 (e nao 201) porque nao cria um recurso novo enderecavel: a
   * resposta e o relatorio da execucao.
   */
  @Post('run')
  @HttpCode(200)
  async run(): Promise<CaptureRunResponse> {
    const { report, joinedRunning } = await this.captures.run();

    return {
      captureId: report.captureId,
      status: report.status,
      startedAt: report.startedAt.toISOString(),
      finishedAt: report.finishedAt.toISOString(),
      nextRunAt: report.nextRunAt.toISOString(),
      totalFound: report.totalFound,
      totalApproved: report.totalApproved,
      totalPersisted: report.totalPersisted,
      totalDuplicated: report.totalDuplicated,
      failedSources: report.failedSources,
      joinedRunning,
    };
  }
}
