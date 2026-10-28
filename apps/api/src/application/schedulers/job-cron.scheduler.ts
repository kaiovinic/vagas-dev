import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { CaptureCoordinator } from '@/application/services/capture-coordinator.service';

/** Captura a cada 2 horas, no fuso de Brasilia (`0 0-23/2 * * *`). */
export const JOB_COLLECTION_CRON = CronExpression.EVERY_2_HOURS;
export const BRASILIA_TIME_ZONE = 'America/Bahia';

/** Nome registrado no SchedulerRegistry, consultado para saber o proximo disparo. */
export const JOB_COLLECTION_JOB_NAME = 'job-collection';

@Injectable()
export class JobCronScheduler {
  private readonly logger = new Logger(JobCronScheduler.name);

  constructor(private readonly captures: CaptureCoordinator) {}

  @Cron(JOB_COLLECTION_CRON, {
    name: JOB_COLLECTION_JOB_NAME,
    timeZone: BRASILIA_TIME_ZONE,
  })
  async handleScheduledCapture(): Promise<void> {
    await this.run();
  }

  /**
   * Uma captura que falha inteira nao pode derrubar o agendador: o erro e
   * registrado e a proxima execucao segue normalmente.
   */
  async run(): Promise<void> {
    try {
      const { report } = await this.captures.run();

      this.logger.log(
        `Captura ${report.captureId} concluida (${report.status}): ` +
          `${report.totalFound} encontradas, ${report.totalPersisted} novas, ` +
          `proxima em ${report.nextRunAt.toISOString()}`,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.error(`Captura agendada falhou: ${message}`);
    }
  }
}
