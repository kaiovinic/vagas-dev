import { Injectable } from '@nestjs/common';

import type {
  ISourceHealthRepository,
  ISourceHealthWriter,
  ISourceLastRunReader,
  SourceHealth,
  SourceRunRecord,
} from '@/domain/repositories/source-health-repository';
import { PrismaService } from '@/infra/prisma/prisma.service';

const MILLISECONDS_IN_HOUR = 60 * 60 * 1000;

@Injectable()
export class PrismaSourceHealthRepository
  implements ISourceHealthWriter, ISourceHealthRepository, ISourceLastRunReader
{
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Quando a fonte rodou pela ultima vez — `null` se nunca rodou.
   *
   * So existe linha para ciclo em que a fonte foi de fato visitada, entao este
   * instante e o da ultima execucao real, e sobrevive a restart e a deploy.
   */
  async getLastRunAt(source: string): Promise<Date | null> {
    const last = await this.prisma.captureSourceLog.findFirst({
      where: { source },
      orderBy: { ranAt: 'desc' },
      select: { ranAt: true },
    });

    return last?.ranAt ?? null;
  }

  async record(entries: readonly SourceRunRecord[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    await this.prisma.captureSourceLog.createMany({
      data: entries.map((entry) => ({
        captureId: entry.captureId,
        source: entry.source,
        totalFound: entry.totalFound,
        failed: entry.failed,
        errorMessage: entry.errorMessage ?? null,
      })),
    });
  }

  /**
   * Duas consultas em vez de uma: o agregado da janela nao diz se a ULTIMA
   * execucao deu certo, e e esse o estado que a tabela mostra. Uma fonte pode
   * ter 11 sucessos e falhar agora — e o que importa e o agora.
   */
  async summarize(reference: Date, windowInHours: number): Promise<SourceHealth[]> {
    const since = new Date(reference.getTime() - windowInHours * MILLISECONDS_IN_HOUR);

    const [aggregates, lastRuns] = await Promise.all([
      this.prisma.captureSourceLog.groupBy({
        by: ['source'],
        where: { ranAt: { gte: since, lte: reference } },
        _count: { _all: true },
        _sum: { totalFound: true },
      }),
      this.prisma.captureSourceLog.findMany({
        where: { ranAt: { lte: reference } },
        distinct: ['source'],
        orderBy: { ranAt: 'desc' },
        select: { source: true, ranAt: true, failed: true },
      }),
    ]);

    const failures = await this.prisma.captureSourceLog.groupBy({
      by: ['source'],
      where: { ranAt: { gte: since, lte: reference }, failed: true },
      _count: { _all: true },
    });

    const failuresBySource = new Map(failures.map((row) => [row.source, row._count._all]));
    const aggregateBySource = new Map(aggregates.map((row) => [row.source, row]));

    return lastRuns.map((last) => {
      const aggregate = aggregateBySource.get(last.source);

      return {
        source: last.source,
        lastRunAt: last.ranAt,
        ok: !last.failed,
        runsInWindow: aggregate?._count._all ?? 0,
        failuresInWindow: failuresBySource.get(last.source) ?? 0,
        totalFoundInWindow: aggregate?._sum.totalFound ?? 0,
      };
    });
  }
}
