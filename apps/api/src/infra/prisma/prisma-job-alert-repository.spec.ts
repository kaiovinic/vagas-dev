import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PrismaJobAlertRepository } from '@/infra/prisma/prisma-job-alert-repository';
import type { PrismaService } from '@/infra/prisma/prisma.service';
import { FIXED_NOW, hoursAgo } from '../../../test/factories/make-job';

interface PrismaStub {
  job: {
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
}

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'job-1',
    source: 'gupy',
    title: 'Desenvolvedor Frontend React',
    company: 'Acme Corp',
    city: 'Salvador/BA',
    workModel: 'REMOTE',
    scope: 'NATIONAL',
    url: 'https://gupy.io/vagas/1',
    description: 'Vaga React',
    tags: ['React'],
    publishedAt: hoursAgo(2),
    ...overrides,
  };
}

describe('PrismaJobAlertRepository', () => {
  let prisma: PrismaStub;
  let repository: PrismaJobAlertRepository;

  beforeEach(() => {
    prisma = {
      job: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn().mockResolvedValue({}) },
    };
    repository = new PrismaJobAlertRepository(prisma as unknown as PrismaService);
  });

  function whereOf(): Record<string, unknown> {
    const call = prisma.job.findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };

    return call.where;
  }

  it('procura so o que ainda nao avisou, aberto e dentro da janela', async () => {
    await repository.findPendingAlerts(FIXED_NOW, 10);

    const where = whereOf();

    expect(where.notifiedAt).toBeNull();
    expect(where.closedAt).toBeNull();
    expect(where.publishedAt).toEqual({ gte: hoursAgo(72), lte: FIXED_NOW });
  });

  it('pede da mais antiga para a mais nova, limitada ao lote', async () => {
    await repository.findPendingAlerts(FIXED_NOW, 7);

    const call = prisma.job.findMany.mock.calls[0]?.[0] as Record<string, unknown>;

    expect(call.orderBy).toEqual({ publishedAt: 'asc' });
    expect(call.take).toBe(7);
  });

  it('remonta o alerta com as tags e o mercado gravados na captura', async () => {
    prisma.job.findMany.mockResolvedValue([row({ tags: ['React', 'Node'], scope: 'INTERNATIONAL' })]);

    const [pending] = await repository.findPendingAlerts(FIXED_NOW, 10);

    expect(pending?.jobId).toBe('job-1');
    expect(pending?.alert.job.location).toBe('Salvador/BA');
    expect(pending?.alert.tags).toEqual(['React', 'Node']);
    expect(pending?.alert.scope).toBe('INTERNATIONAL');
  });

  it('vaga sem cidade vira alerta sem localidade, e nao erro', async () => {
    prisma.job.findMany.mockResolvedValue([row({ city: null })]);

    const [pending] = await repository.findPendingAlerts(FIXED_NOW, 10);

    expect(pending?.alert.job.location).toBe('');
  });

  it('descarta a linha estragada e a marca como avisada, para nao travar o lote', async () => {
    prisma.job.findMany.mockResolvedValue([row({ id: 'quebrada', title: '  ' }), row()]);

    const pending = await repository.findPendingAlerts(FIXED_NOW, 10);

    expect(pending.map((entry) => entry.jobId)).toEqual(['job-1']);
    expect(prisma.job.update).toHaveBeenCalledWith({
      where: { id: 'quebrada' },
      data: { notifiedAt: FIXED_NOW },
    });
  });

  it('marca a vaga avisada com o instante do envio', async () => {
    await repository.markNotified('job-1', FIXED_NOW);

    expect(prisma.job.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { notifiedAt: FIXED_NOW },
    });
  });
});
