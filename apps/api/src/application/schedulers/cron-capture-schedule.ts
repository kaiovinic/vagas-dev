import { Injectable, Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

import type { ICaptureSchedule } from '@/domain/providers/capture-schedule';
import { JOB_COLLECTION_JOB_NAME } from '@/application/schedulers/job-cron.scheduler';

const MILLISECONDS_IN_HOUR = 60 * 60 * 1000;

/** Usado so quando o cron nao esta registrado (script avulso, teste). */
export const CAPTURE_INTERVAL_FALLBACK_IN_HOURS = 2;

/**
 * Le o proximo disparo direto do cron registrado no Nest.
 *
 * Antes isso era "agora + 2h", o que batia enquanto so o cron capturava. Com o
 * botao manual deixou de bater: uma captura as 20:57 anunciava a proxima as
 * 22:57, mas o cron dispara as 22:00.
 */
@Injectable()
export class CronCaptureSchedule implements ICaptureSchedule {
  private readonly logger = new Logger(CronCaptureSchedule.name);

  constructor(private readonly schedulerRegistry: SchedulerRegistry) {}

  nextRunAt(reference: Date): Date {
    try {
      const job = this.schedulerRegistry.getCronJob(JOB_COLLECTION_JOB_NAME);

      return job.nextDate().toJSDate();
    } catch (error: unknown) {
      // Captura disparada fora da aplicacao (script, teste): nao ha cron para consultar.
      this.logger.debug(
        `Cron "${JOB_COLLECTION_JOB_NAME}" indisponivel; usando intervalo padrao: ${describeError(error)}`,
      );

      return new Date(
        reference.getTime() + CAPTURE_INTERVAL_FALLBACK_IN_HOURS * MILLISECONDS_IN_HOUR,
      );
    }
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
