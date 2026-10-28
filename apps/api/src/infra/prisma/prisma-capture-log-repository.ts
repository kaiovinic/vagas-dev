import { Injectable } from '@nestjs/common';

import type {
  FinishCaptureInput,
  ICaptureLogRepository,
  LastCaptureSnapshot,
  StartCaptureInput,
} from '@/domain/repositories/capture-log-repository';
import { PrismaService } from '@/infra/prisma/prisma.service';

@Injectable()
export class PrismaCaptureLogRepository implements ICaptureLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async start(input: StartCaptureInput): Promise<string> {
    const { id } = await this.prisma.captureLog.create({
      data: {
        startedAt: input.startedAt,
        nextRunAt: input.nextRunAt,
        status: 'RUNNING',
      },
      select: { id: true },
    });

    return id;
  }

  async finish(input: FinishCaptureInput): Promise<void> {
    await this.prisma.captureLog.update({
      where: { id: input.captureId },
      data: {
        finishedAt: input.finishedAt,
        status: input.status,
        totalFound: input.totalFound,
        totalApproved: input.totalApproved,
        totalRejected: input.totalRejected,
        totalDuplicated: input.totalDuplicated,
        totalPersisted: input.totalPersisted,
        failedSources: [...input.failedSources],
        errorMessage: input.errorMessage ?? null,
      },
    });
  }

  /** Ignora capturas ainda em RUNNING: o cabecalho mostra a ultima concluida. */
  async findLastFinished(): Promise<LastCaptureSnapshot | null> {
    const row = await this.prisma.captureLog.findFirst({
      where: { finishedAt: { not: null } },
      orderBy: { startedAt: 'desc' },
      select: {
        startedAt: true,
        finishedAt: true,
        nextRunAt: true,
        status: true,
        totalPersisted: true,
        failedSources: true,
      },
    });

    if (!row) {
      return null;
    }

    return {
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      nextRunAt: row.nextRunAt,
      status: row.status,
      totalPersisted: row.totalPersisted,
      failedSources: row.failedSources,
    };
  }
}
