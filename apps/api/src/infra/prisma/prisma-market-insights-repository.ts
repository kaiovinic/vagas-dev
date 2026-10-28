import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import type {
  BucketCount,
  IMarketInsightsRepository,
  KeywordBucket,
  ScopeCount,
  WorkModelCount,
} from '@/domain/repositories/market-insights-repository';
import { PUBLICATION_WINDOW_IN_HOURS } from '@/domain/services/job-rule-engine';
import { PrismaService } from '@/infra/prisma/prisma.service';

const MILLISECONDS_IN_HOUR = 60 * 60 * 1000;

@Injectable()
export class PrismaMarketInsightsRepository implements IMarketInsightsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async countOpenJobs(reference: Date): Promise<number> {
    return this.prisma.job.count({ where: openWindow(reference) });
  }

  async countByWorkModel(reference: Date): Promise<WorkModelCount[]> {
    const rows = await this.prisma.job.groupBy({
      by: ['workModel'],
      where: openWindow(reference),
      _count: { _all: true },
    });

    return rows.map((row) => ({ workModel: row.workModel, total: row._count._all }));
  }

  async countByScope(reference: Date): Promise<ScopeCount[]> {
    const rows = await this.prisma.job.groupBy({
      by: ['scope'],
      where: openWindow(reference),
      _count: { _all: true },
    });

    return rows.map((row) => ({ scope: row.scope, total: row._count._all }));
  }

  /**
   * Uma contagem por grupo, em paralelo. Sao poucos grupos (9 stacks, 4 niveis) e
   * a tabela e pequena; um `GROUP BY` unico exigiria SQL cru com um CASE por termo.
   */
  async countByKeywordBuckets(
    reference: Date,
    buckets: readonly KeywordBucket[],
  ): Promise<BucketCount[]> {
    const counts = await Promise.all(
      buckets.map((bucket) =>
        this.prisma.job.count({
          where: { ...openWindow(reference), OR: bucketMatchers(bucket) },
        }),
      ),
    );

    return buckets.map((bucket, index) => ({
      id: bucket.id,
      label: bucket.label,
      total: counts[index] ?? 0,
    }));
  }
}

function openWindow(reference: Date): Prisma.JobWhereInput {
  return {
    publishedAt: {
      gte: new Date(reference.getTime() - PUBLICATION_WINDOW_IN_HOURS * MILLISECONDS_IN_HOUR),
      lte: reference,
    },
  };
}

function bucketMatchers(bucket: KeywordBucket): Prisma.JobWhereInput[] {
  const titleMatchers = bucket.keywords.map((keyword) => ({
    title: { contains: keyword, mode: 'insensitive' as const },
  }));

  if (bucket.scope === 'TITLE') {
    return titleMatchers;
  }

  return [
    ...titleMatchers,
    ...bucket.keywords.map((keyword) => ({
      description: { contains: keyword, mode: 'insensitive' as const },
    })),
    { tags: { hasSome: [...bucket.keywords] } },
  ];
}
