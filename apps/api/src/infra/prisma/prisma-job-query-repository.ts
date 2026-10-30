import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import type {
  HiringEntityCount,
  IJobQueryRepository,
  JobListFilters,
  JobListItem,
  PaginatedJobs,
} from '@/domain/repositories/job-query-repository';
import { PrismaService } from '@/infra/prisma/prisma.service';

const LIST_SELECTION = {
  id: true,
  fingerprint: true,
  title: true,
  company: true,
  recruiterName: true,
  source: true,
  city: true,
  isRemote: true,
  scope: true,
  workModel: true,
  url: true,
  tags: true,
  description: true,
  publishedAt: true,
  publishedAtSource: true,
} as const;

@Injectable()
export class PrismaJobQueryRepository implements IJobQueryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: JobListFilters): Promise<PaginatedJobs> {
    const where = buildWhere(filters);

    const [rows, total] = await Promise.all([
      this.prisma.job.findMany({
        where,
        select: LIST_SELECTION,
        orderBy: { [filters.sortBy]: filters.sortDirection },
        skip: (filters.page - 1) * filters.perPage,
        take: filters.perPage,
      }),
      this.prisma.job.count({ where }),
    ]);

    return {
      items: rows satisfies readonly JobListItem[],
      total,
      page: filters.page,
      perPage: filters.perPage,
    };
  }

  /**
   * O Prisma nao faz contagem condicional dentro de um `groupBy`, por isso o total
   * geral e o total de remotas saem de dois agrupamentos combinados em memoria.
   */
  async countByCompany(publishedAfter: Date): Promise<HiringEntityCount[]> {
    const where: Prisma.JobWhereInput = {
      publishedAt: { gte: publishedAfter },
      company: { not: '' },
    };

    const [all, remote] = await Promise.all([
      this.prisma.job.groupBy({
        by: ['company'],
        where,
        _count: { _all: true },
        _max: { publishedAt: true },
      }),
      this.prisma.job.groupBy({
        by: ['company'],
        where: { ...where, isRemote: true },
        _count: { _all: true },
      }),
    ]);

    return mergeCounts(
      all.map((row) => ({
        name: row.company,
        total: row._count._all,
        lastPublishedAt: row._max.publishedAt,
      })),
      remote.map((row) => ({ name: row.company, total: row._count._all })),
    );
  }

  async countByRecruiter(publishedAfter: Date): Promise<HiringEntityCount[]> {
    const where: Prisma.JobWhereInput = {
      publishedAt: { gte: publishedAfter },
      recruiterName: { not: null },
    };

    const [all, remote] = await Promise.all([
      this.prisma.job.groupBy({
        by: ['recruiterName'],
        where,
        _count: { _all: true },
        _max: { publishedAt: true },
      }),
      this.prisma.job.groupBy({
        by: ['recruiterName'],
        where: { ...where, isRemote: true },
        _count: { _all: true },
      }),
    ]);

    return mergeCounts(
      all.map((row) => ({
        name: row.recruiterName,
        total: row._count._all,
        lastPublishedAt: row._max.publishedAt,
      })),
      remote.map((row) => ({ name: row.recruiterName, total: row._count._all })),
    );
  }
}

interface GroupedTotal {
  readonly name: string | null;
  readonly total: number;
  readonly lastPublishedAt: Date | null;
}

interface RemoteTotal {
  readonly name: string | null;
  readonly total: number;
}

function mergeCounts(
  all: readonly GroupedTotal[],
  remote: readonly RemoteTotal[],
): HiringEntityCount[] {
  const remoteByName = new Map(remote.map((row) => [readName(row.name), row.total]));

  return all
    .flatMap((row) => {
      const name = readName(row.name);

      if (name.length === 0 || !row.lastPublishedAt) {
        return [];
      }

      return [
        {
          name,
          total: row.total,
          remoteTotal: remoteByName.get(name) ?? 0,
          lastPublishedAt: row.lastPublishedAt,
        },
      ];
    })
    .sort(byTotalThenName);
}

function buildWhere(filters: JobListFilters): Prisma.JobWhereInput {
  const where: Prisma.JobWhereInput = {};

  if (filters.source) {
    where.source = filters.source;
  }

  if (filters.scope) {
    where.scope = filters.scope;
  }

  if (filters.isRemote !== undefined) {
    where.isRemote = filters.isRemote;
  }

  if (filters.publishedAfter) {
    where.publishedAt = { gte: filters.publishedAfter };
  }

  if (filters.company) {
    where.company = { equals: filters.company, mode: 'insensitive' };
  }

  if (filters.recruiterName) {
    where.recruiterName = { equals: filters.recruiterName, mode: 'insensitive' };
  }

  if (filters.city) {
    where.city = { contains: filters.city, mode: 'insensitive' };
  }

  if (filters.search) {
    where.OR = [
      { title: { contains: filters.search, mode: 'insensitive' } },
      { company: { contains: filters.search, mode: 'insensitive' } },
      { description: { contains: filters.search, mode: 'insensitive' } },
    ];
  }

  // Cada grupo vai em AND para nao se misturar ao OR da busca textual: a vaga
  // precisa casar com a busca E com uma das tecnologias E com uma senioridade.
  const groups: Prisma.JobWhereInput[] = [];
  const technologies = filters.technologies ?? [];
  const seniorities = filters.seniorityKeywords ?? [];

  if (technologies.length > 0) {
    groups.push({ OR: technologyMatchers(technologies) });
  }

  if (seniorities.length > 0) {
    // Senioridade so no titulo: a descricao e as tags geravam falso positivo
    // — "Vaga internacional" fazia vaga senior ser classificada como estagio.
    groups.push({ OR: titleMatchers(seniorities) });
  }

  if (groups.length > 0) {
    where.AND = groups;
  }

  return where;
}

/** Casa a tecnologia no titulo, na descricao ou nas tags da vaga. */
function technologyMatchers(keywords: readonly string[]): Prisma.JobWhereInput[] {
  const textMatchers = keywords.flatMap((keyword) => [
    { title: { contains: keyword, mode: 'insensitive' } },
    { description: { contains: keyword, mode: 'insensitive' } },
  ]) satisfies Prisma.JobWhereInput[];

  return [...textMatchers, { tags: { hasSome: [...keywords] } }];
}

function titleMatchers(keywords: readonly string[]): Prisma.JobWhereInput[] {
  return keywords.map((keyword) => ({
    title: { contains: keyword, mode: 'insensitive' },
  })) satisfies Prisma.JobWhereInput[];
}

function readName(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function byTotalThenName(first: HiringEntityCount, second: HiringEntityCount): number {
  if (second.total !== first.total) {
    return second.total - first.total;
  }

  return first.name.localeCompare(second.name);
}
