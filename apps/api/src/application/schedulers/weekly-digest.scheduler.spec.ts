import { describe, expect, it, vi } from 'vitest';

import {
  WEEKLY_DIGEST_CRON,
  WEEKLY_DIGEST_JOB_NAME,
  WeeklyDigestScheduler,
} from '@/application/schedulers/weekly-digest.scheduler';
import type { SendWeeklyDigestUseCase } from '@/application/use-cases/send-weekly-digest.use-case';
import type { WeeklyDigest } from '@/domain/providers/telegram-notifier';
import { FIXED_NOW } from '../../../test/factories/make-job';

const DIGEST: WeeklyDigest = {
  periodStart: new Date(FIXED_NOW.getTime() - 7 * 24 * 60 * 60 * 1000),
  periodEnd: FIXED_NOW,
  openJobs: 88,
  newInPeriod: 134,
  remoteJobs: 74,
  localJobs: 14,
  topTechnologies: [{ label: 'React', total: 61 }],
};

function schedulerWith(execute: ReturnType<typeof vi.fn>): WeeklyDigestScheduler {
  return new WeeklyDigestScheduler({ execute } as unknown as SendWeeklyDigestUseCase);
}

describe('WeeklyDigestScheduler', () => {
  it('dispara toda segunda-feira as 08:00', () => {
    expect(WEEKLY_DIGEST_CRON).toBe('0 8 * * 1');
  });

  it('registra o job com nome proprio, separado da captura', () => {
    expect(WEEKLY_DIGEST_JOB_NAME).toBe('weekly-digest');
  });

  it('executa o caso de uso no horario', async () => {
    const execute = vi.fn().mockResolvedValue(DIGEST);

    await schedulerWith(execute).handleScheduledDigest();

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('nao propaga falha: o agendador da captura roda no mesmo processo', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('telegram fora do ar'));

    await expect(schedulerWith(execute).run()).resolves.toBeUndefined();
  });

  it('nao propaga falha que nao e Error', async () => {
    const execute = vi.fn().mockRejectedValue('falha crua');

    await expect(schedulerWith(execute).run()).resolves.toBeUndefined();
  });
});
