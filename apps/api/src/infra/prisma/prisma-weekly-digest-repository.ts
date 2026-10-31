import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import type {
  BucketCount,
  KeywordBucket,
} from '@/domain/repositories/market-insights-repository';
import type {
  IWeeklyDigestRepository,
  WeeklyDigestSnapshot,
} from '@/domain/repositories/weekly-digest-repository';
import { PUBLICATION_WINDOW_IN_HOURS } from '@/domain/services/job-rule-engine';
import { PrismaService } from '@/infra/prisma/prisma.service';

const MILLISECONDS_IN_HOUR = 60 * 60 * 1000;
const HOURS_IN_DAY = 24;

@Injectable()
export class PrismaWeeklyDigestRepository implements IWeeklyDigestRepository {
  constructor(private readonly prisma: PrismaService) {}

  async summarize(
    reference: Date,
    periodInDays: number,
    buckets: readonly KeywordBucket[],
  ): Promise<WeeklyDigestSnapshot> {
    const open = window(reference, PUBLICATION_WINDOW_IN_HOURS);
    const period = window(reference, periodInDays * HOURS_IN_DAY);

    const [openJobs, newInPeriod, remoteJobs, localJobs, technologies] = await Promise.all([
      this.prisma.job.count({ where: open }),
      this.prisma.job.count({ where: period }),
      this.prisma.job.count({ where: { ...open, isRemote: true } }),
      // O motor so aprova remoto OU Bahia, entao o que nao e remoto
      // dentro da janela e, por construcao, vaga da regiao.
      this.prisma.job.count({ where: { ...open, isRemote: false } }),
      this.countBuckets(period, buckets),
    ]);

    return { openJobs, newInPeriod, remoteJobs, localJobs, technologies };
  }

  /** Uma contagem por grupo, como na aba Mercado: sao poucos grupos. */
  private async countBuckets(
    where: Prisma.JobWhereInput,
    buckets: readonly KeywordBucket[],
  ): Promise<BucketCount[]> {
    const counts = await Promise.all(
      buckets.map((bucket) =>
        this.prisma.job.count({ where: { ...where, OR: bucketMatchers(bucket) } }),
      ),
    );

    return buckets.map((bucket, index) => ({
      id: bucket.id,
      label: bucket.label,
      total: counts[index] ?? 0,
    }));
  }
}

function window(reference: Date, hours: number): Prisma.JobWhereInput {
  return {
    publishedAt: {
      gte: new Date(reference.getTime() - hours * MILLISECONDS_IN_HOUR),
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
