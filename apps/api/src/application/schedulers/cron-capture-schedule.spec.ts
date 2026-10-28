import { describe, expect, it, vi } from 'vitest';
import type { SchedulerRegistry } from '@nestjs/schedule';

import {
  CAPTURE_INTERVAL_FALLBACK_IN_HOURS,
  CronCaptureSchedule,
} from '@/application/schedulers/cron-capture-schedule';
import { JOB_COLLECTION_JOB_NAME } from '@/application/schedulers/job-cron.scheduler';
import { FIXED_NOW } from '../../../test/factories/make-job';

const PROXIMO_SLOT = new Date('2026-10-26T14:00:00.000Z');

function registryWithJob(nextDate: Date): SchedulerRegistry {
  return {
    getCronJob: vi.fn().mockReturnValue({
      nextDate: () => ({ toJSDate: () => nextDate }),
    }),
  } as unknown as SchedulerRegistry;
}

function registryWithoutJob(): SchedulerRegistry {
  return {
    getCronJob: vi.fn(() => {
      throw new Error(`No Cron Job was found with the given name (${JOB_COLLECTION_JOB_NAME})`);
    }),
  } as unknown as SchedulerRegistry;
}

describe('CronCaptureSchedule', () => {
  it('devolve o proximo disparo do cron registrado', () => {
    const registry = registryWithJob(PROXIMO_SLOT);

    expect(new CronCaptureSchedule(registry).nextRunAt(FIXED_NOW)).toEqual(PROXIMO_SLOT);
  });

  it('consulta o cron pelo nome registrado', () => {
    const registry = registryWithJob(PROXIMO_SLOT);

    new CronCaptureSchedule(registry).nextRunAt(FIXED_NOW);

    expect(registry.getCronJob).toHaveBeenCalledWith(JOB_COLLECTION_JOB_NAME);
  });

  it('ignora a referencia quando o cron responde', () => {
    const registry = registryWithJob(PROXIMO_SLOT);
    const captureTardia = new Date('2026-10-26T13:57:00.000Z');

    // Captura manual as 13:57 anuncia 14:00, nao 15:57.
    expect(new CronCaptureSchedule(registry).nextRunAt(captureTardia)).toEqual(PROXIMO_SLOT);
  });

  it('cai no intervalo padrao quando o cron nao esta registrado', () => {
    const esperado = new Date(
      FIXED_NOW.getTime() + CAPTURE_INTERVAL_FALLBACK_IN_HOURS * 60 * 60 * 1000,
    );

    expect(new CronCaptureSchedule(registryWithoutJob()).nextRunAt(FIXED_NOW)).toEqual(esperado);
  });

  it('usa intervalo de 2 horas no fallback', () => {
    expect(CAPTURE_INTERVAL_FALLBACK_IN_HOURS).toBe(2);
  });

  it('nao propaga a falha do agendador', () => {
    const registry = {
      getCronJob: vi.fn(() => {
        throw 'falha crua';
      }),
    } as unknown as SchedulerRegistry;

    expect(() => new CronCaptureSchedule(registry).nextRunAt(FIXED_NOW)).not.toThrow();
  });
});
