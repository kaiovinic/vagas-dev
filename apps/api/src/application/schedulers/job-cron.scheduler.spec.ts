import { describe, expect, it, vi } from 'vitest';

import {
  BRASILIA_TIME_ZONE,
  JOB_COLLECTION_CRON,
  JobCronScheduler,
} from '@/application/schedulers/job-cron.scheduler';
import type { CaptureCoordinator } from '@/application/services/capture-coordinator.service';
import { FIXED_NOW } from '../../../test/factories/make-job';

function coordinatorStub(result: unknown): CaptureCoordinator {
  const run =
    result instanceof Error
      ? vi.fn().mockRejectedValue(result)
      : vi.fn().mockResolvedValue({ report: result, joinedRunning: false });

  return { run } as unknown as CaptureCoordinator;
}

const REPORT = {
  captureId: 'capture-1',
  startedAt: FIXED_NOW,
  finishedAt: FIXED_NOW,
  nextRunAt: new Date(FIXED_NOW.getTime() + 7_200_000),
  status: 'SUCCESS' as const,
  totalFound: 10,
  totalApproved: 4,
  totalRejected: 6,
  totalDuplicated: 1,
  totalPersisted: 3,
  failedSources: [],
};

describe('JobCronScheduler', () => {
  it('roda a cada 2 horas no fuso de Brasilia', () => {
    expect(JOB_COLLECTION_CRON).toBe('0 0-23/2 * * *');
    expect(BRASILIA_TIME_ZONE).toBe('America/Bahia');
  });

  it('dispara a captura no horario agendado', async () => {
    const coordinator = coordinatorStub(REPORT);

    await new JobCronScheduler(coordinator).handleScheduledCapture();

    expect(coordinator.run).toHaveBeenCalledTimes(1);
  });

  it('nao propaga erro quando a captura falha inteira', async () => {
    const coordinator = coordinatorStub(new Error('banco indisponivel'));

    await expect(new JobCronScheduler(coordinator).run()).resolves.toBeUndefined();
  });

  it('nao propaga falha que nao e Error', async () => {
    const coordinator = { run: vi.fn().mockRejectedValue('falha crua') } as unknown as CaptureCoordinator;

    await expect(new JobCronScheduler(coordinator).run()).resolves.toBeUndefined();
  });
});
