import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import type {
  ISeniorityMetricsRepository,
  SeniorityBucketCount,
  TitleSeniorityBucket,
} from '@/domain/repositories/seniority-metrics-repository';
import type { CalendarRange } from '@/domain/services/brasilia-calendar';
import { PrismaService } from '@/infra/prisma/prisma.service';

/**
 * Distribuicao por senioridade sobre a data de captura (`createdAt`).
 *
 * Uma contagem por nivel, em paralelo, como na aba Mercado: sao cinco grupos e
 * um `GROUP BY` unico exigiria SQL cru com um CASE por termo de busca.
 */
@Injectable()
export class PrismaSeniorityMetricsRepository implements ISeniorityMetricsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async countCapturedJobs(range: CalendarRange): Promise<number> {
    return this.prisma.job.count({ where: capturedIn(range) });
  }

  async countCapturedByTitleBucket(
    range: CalendarRange,
    buckets: readonly TitleSeniorityBucket[],
  ): Promise<SeniorityBucketCount[]> {
    const totals = await Promise.all(
      buckets.map((bucket) =>
        this.prisma.job.count({ where: { ...capturedIn(range), ...bucketFilter(bucket) } }),
      ),
    );

    return buckets.map((bucket, index) => ({ id: bucket.id, total: totals[index] ?? 0 }));
  }
}

/**
 * Intervalo fechado-aberto sobre a captura. O `lt` na borda superior e o que
 * impede a vaga da meia-noite de ser contada no dia 31 e no dia 1.
 */
function capturedIn(range: CalendarRange): Prisma.JobWhereInput {
  return { createdAt: { gte: range.start, lt: range.end } };
}

function bucketFilter(bucket: TitleSeniorityBucket): Prisma.JobWhereInput {
  const matchers = titleMatchers(bucket.keywords);

  if (bucket.outranked.length === 0) {
    return { OR: matchers };
  }

  return { OR: matchers, NOT: { OR: titleMatchers(bucket.outranked) } };
}

function titleMatchers(keywords: readonly string[]): Prisma.JobWhereInput[] {
  return keywords.map((keyword) => ({
    title: { contains: keyword, mode: 'insensitive' as const },
  }));
}
