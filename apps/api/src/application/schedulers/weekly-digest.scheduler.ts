import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { SendWeeklyDigestUseCase } from '@/application/use-cases/send-weekly-digest.use-case';
import { BRASILIA_TIME_ZONE } from '@/application/schedulers/job-cron.scheduler';

/** Segunda-feira, 08:00 de Brasilia: a semana comecando, antes do expediente. */
export const WEEKLY_DIGEST_CRON = '0 8 * * 1';

export const WEEKLY_DIGEST_JOB_NAME = 'weekly-digest';

@Injectable()
export class WeeklyDigestScheduler {
  private readonly logger = new Logger(WeeklyDigestScheduler.name);

  constructor(private readonly digest: SendWeeklyDigestUseCase) {}

  @Cron(WEEKLY_DIGEST_CRON, {
    name: WEEKLY_DIGEST_JOB_NAME,
    timeZone: BRASILIA_TIME_ZONE,
  })
  async handleScheduledDigest(): Promise<void> {
    await this.run();
  }

  /**
   * Um resumo que falha nao pode derrubar o agendador — nem o da captura, que
   * roda no mesmo processo. O erro fica no log e a proxima segunda tenta de novo.
   */
  async run(): Promise<void> {
    try {
      const sent = await this.digest.execute();

      this.logger.log(
        `Resumo semanal enviado: ${sent.openJobs} vagas abertas, ` +
          `${sent.newInPeriod} publicadas nos ultimos 7 dias`,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.error(`Resumo semanal falhou: ${message}`);
    }
  }
}
