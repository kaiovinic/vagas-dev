import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type {
  CaptureBucketCount,
  DailySourceJobCount,
  IDashboardMetricsRepository,
  OpenJobsSummary,
  SourceJobCount,
} from '@/domain/repositories/dashboard-metrics-repository';
import type {
  IJobWriteRepository,
  PersistableJob,
  SaveJobsResult,
} from '@/domain/repositories/job-write-repository';
import { PUBLICATION_WINDOW_IN_HOURS } from '@/domain/services/job-rule-engine';
import { OPEN_JOBS } from '@/infra/prisma/support/open-jobs';
import { PrismaService } from '@/infra/prisma/prisma.service';

const MILLISECONDS_IN_HOUR = 60 * 60 * 1000;
const BRASILIA_TIME_ZONE = 'America/Bahia';
const KPI_WINDOW_IN_HOURS = 24;
const CAPTURE_BLOCK_IN_HOURS = 2;
const CAPTURE_BLOCKS_IN_24H = 12;

interface CaptureBucketRow {
  readonly start: Date;
  readonly label: string;
  readonly total: number | bigint;
}

interface DailyCountRow {
  readonly day: string;
  readonly source: string;
  readonly total: number | bigint;
}

/**
 * Implementacao Prisma dos dois contratos segregados do dominio. A classe reune
 * as duas interfaces porque a tabela e a mesma, mas cada caso de uso depende
 * apenas do contrato de que precisa (ISP).
 */
@Injectable()
export class PrismaJobRepository implements IJobWriteRepository, IDashboardMetricsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findExistingFingerprints(fingerprints: readonly string[]): Promise<string[]> {
    if (fingerprints.length === 0) {
      return [];
    }

    const rows = await this.prisma.job.findMany({
      where: { fingerprint: { in: [...fingerprints] } },
      select: { fingerprint: true },
    });

    return rows.map((row) => row.fingerprint);
  }

  /**
   * Vagas novas sao inseridas; as que ja existiam (mesmo fingerprint, ainda que de
   * outra fonte) apenas renovam `lastSeenAt`, preservando a data da primeira captura.
   */
  async saveMany(jobs: readonly PersistableJob[]): Promise<SaveJobsResult> {
    if (jobs.length === 0) {
      return { created: 0, duplicated: 0 };
    }

    const seenAt = new Date();
    const existing = new Set(
      await this.findExistingFingerprints(jobs.map((entry) => entry.job.fingerprint.value)),
    );
    const newJobs = jobs.filter((entry) => !existing.has(entry.job.fingerprint.value));

    if (existing.size > 0) {
      await this.prisma.job.updateMany({
        where: { fingerprint: { in: [...existing] } },
        data: { lastSeenAt: seenAt },
      });

      await this.fillEmptyDescriptions(jobs.filter((entry) => existing.has(entry.job.fingerprint.value)));
    }

    if (newJobs.length === 0) {
      return { created: 0, duplicated: jobs.length };
    }

    const { count } = await this.prisma.job.createMany({
      data: newJobs.map((entry) => toCreateInput(entry, seenAt)),
      skipDuplicates: true,
    });

    return { created: count, duplicated: jobs.length - count };
  }

  /**
   * Completa a descricao da vaga que foi gravada sem nenhuma.
   *
   * Acontece por projeto, e nao por acidente: o coletor do LinkedIn tem teto de
   * detalhes por ciclo, entao a vaga aprovada no ciclo em que o teto estourou e
   * gravada com a descricao vazia e so tem o texto no ciclo seguinte. Sem este
   * preenchimento, a linha ficaria vazia pelo resto da vida, porque o caminho de
   * gravacao nunca reescreve vaga existente.
   *
   * O `description: ''` no `where` e o que protege o texto ja gravado: aqui so
   * se preenche o que esta faltando, nunca se sobrescreve.
   */
  private async fillEmptyDescriptions(entries: readonly PersistableJob[]): Promise<void> {
    const withText = entries.filter((entry) => entry.job.description.length > 0);

    await Promise.all(
      withText.map((entry) =>
        this.prisma.job.updateMany({
          where: { fingerprint: entry.job.fingerprint.value, description: '' },
          data: { description: entry.job.description },
        }),
      ),
    );
  }

  async getOpenJobsSummary(reference: Date): Promise<OpenJobsSummary> {
    const openWindow = publicationWindow(reference, PUBLICATION_WINDOW_IN_HOURS);

    const [openJobs, newInLast24h, newInPrevious24h, remoteJobs, companies] = await Promise.all([
      this.prisma.job.count({ where: { ...OPEN_JOBS, publishedAt: openWindow } }),
      this.prisma.job.count({
        where: { ...OPEN_JOBS, publishedAt: publicationWindow(reference, KPI_WINDOW_IN_HOURS) },
      }),
      this.prisma.job.count({
        where: { ...OPEN_JOBS, publishedAt: previousWindow(reference, KPI_WINDOW_IN_HOURS) },
      }),
      this.prisma.job.count({
        where: { ...OPEN_JOBS, publishedAt: openWindow, isRemote: true },
      }),
      this.prisma.job.groupBy({
        by: ['company'],
        where: { ...OPEN_JOBS, publishedAt: openWindow, company: { not: '' } },
      }),
    ]);

    return { openJobs, newInLast24h, newInPrevious24h, remoteJobs, hiringCompanies: companies.length };
  }

  async countOpenJobsBySource(reference: Date): Promise<SourceJobCount[]> {
    const rows = await this.prisma.job.groupBy({
      by: ['source'],
      where: {
        ...OPEN_JOBS,
        publishedAt: publicationWindow(reference, PUBLICATION_WINDOW_IN_HOURS),
      },
      _count: { _all: true },
    });

    return rows
      .map((row) => ({ source: row.source, total: row._count._all }))
      .sort((first, second) => second.total - first.total);
  }

  /**
   * Agrupa por dia de publicacao no horario de Brasilia. O bucket precisa ser feito
   * no banco (`AT TIME ZONE`) para que a virada do dia nao caia na meia-noite UTC.
   */
  async countJobsByDayAndSource(reference: Date, days: number): Promise<DailySourceJobCount[]> {
    // As datas vao como texto ISO e sao lidas como `timestamptz`: um parametro
    // `Date` cru seria serializado no fuso do processo e comparado contra uma
    // coluna `timestamp` sem fuso, deslocando a janela em 3 horas.
    const start = subtractHours(reference, days * 24).toISOString();
    const end = reference.toISOString();

    const rows = await this.prisma.$queryRaw<DailyCountRow[]>(Prisma.sql`
      SELECT to_char("publishedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${BRASILIA_TIME_ZONE}, 'YYYY-MM-DD') AS day,
             "source" AS source,
             COUNT(*) AS total
      FROM "jobs"
      WHERE "closedAt" IS NULL
        AND "publishedAt" >= (${start}::timestamptz AT TIME ZONE 'UTC')
        AND "publishedAt" <= (${end}::timestamptz AT TIME ZONE 'UTC')
      GROUP BY 1, 2
      ORDER BY 1 ASC, 3 DESC
    `);

    return rows.map((row) => ({ day: row.day, source: row.source, total: Number(row.total) }));
  }

  /**
   * Volumetria de ingestao (`createdAt`) das ultimas 24h em blocos de 2 horas.
   *
   * Os blocos vem do `generate_series` e as vagas entram por `LEFT JOIN`, e nao do
   * agrupamento das linhas existentes: assim o ciclo que nao trouxe nada aparece
   * como barra zerada em vez de desaparecer do grafico, que e o caso que importa.
   *
   * O inicio e ancorado na hora par de Brasilia para que cada bloco caia sobre o
   * ciclo de captura, que roda de 2 em 2 horas, e nao no meio de dois ciclos.
   */
  async findCapturesTimeline24h(reference: Date): Promise<CaptureBucketCount[]> {
    // Mesmo cuidado da consulta por dia: texto ISO lido como `timestamptz` e
    // trazido para UTC, porque a coluna e `timestamp` sem fuso.
    const lastBlock = startOfCaptureBlock(reference);
    const end = lastBlock.toISOString();
    const start = subtractHours(
      lastBlock,
      (CAPTURE_BLOCKS_IN_24H - 1) * CAPTURE_BLOCK_IN_HOURS,
    ).toISOString();

    const rows = await this.prisma.$queryRaw<CaptureBucketRow[]>(Prisma.sql`
      WITH blocks AS (
        SELECT generate_series(
          (${start}::timestamptz AT TIME ZONE 'UTC'),
          (${end}::timestamptz AT TIME ZONE 'UTC'),
          INTERVAL '2 hours'
        ) AS block_start
      )
      SELECT blocks.block_start AS "start",
             to_char(blocks.block_start AT TIME ZONE 'UTC' AT TIME ZONE ${BRASILIA_TIME_ZONE}, 'HH24:MI') AS "label",
             COUNT("jobs"."id") AS "total"
      FROM blocks
      LEFT JOIN "jobs"
        ON "jobs"."createdAt" >= blocks.block_start
       AND "jobs"."createdAt" < blocks.block_start + INTERVAL '2 hours'
      GROUP BY 1, 2
      ORDER BY 1 ASC
    `);

    return rows.map((row) => ({
      start: new Date(row.start),
      label: row.label,
      total: Number(row.total),
    }));
  }
}

/**
 * Inicio do bloco de 2 horas que contem a referencia, ancorado na hora par de
 * Brasilia. A paridade e lida no fuso de Brasilia, e nao em UTC, para que o
 * rotulo do bloco bata com a hora que o usuario ve no dashboard.
 */
function startOfCaptureBlock(reference: Date): Date {
  const hourInBrasilia = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: BRASILIA_TIME_ZONE,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(reference),
  );
  const flooredToHour = new Date(reference);

  flooredToHour.setUTCMinutes(0, 0, 0);

  return subtractHours(flooredToHour, hourInBrasilia % CAPTURE_BLOCK_IN_HOURS);
}

function toCreateInput(entry: PersistableJob, seenAt: Date): Prisma.JobCreateManyInput {
  const { job } = entry;

  return {
    fingerprint: job.fingerprint.value,
    source: job.source,
    title: job.title,
    company: job.company,
    recruiterName: entry.recruiterName.length > 0 ? entry.recruiterName : null,
    city: job.location.length > 0 ? job.location : null,
    isRemote: job.workModel === 'REMOTE',
    scope: entry.scope,
    workModel: job.workModel,
    url: job.url,
    description: job.description,
    tags: [...entry.tags],
    publishedAt: job.publishedAt,
    publishedAtSource: entry.publishedAtSource,
    firstSeenAt: seenAt,
    lastSeenAt: seenAt,
  };
}

function publicationWindow(reference: Date, windowInHours: number): Prisma.DateTimeFilter {
  return { gte: subtractHours(reference, windowInHours), lte: reference };
}

function previousWindow(reference: Date, windowInHours: number): Prisma.DateTimeFilter {
  return {
    gte: subtractHours(reference, windowInHours * 2),
    lt: subtractHours(reference, windowInHours),
  };
}

function subtractHours(reference: Date, hours: number): Date {
  return new Date(reference.getTime() - hours * MILLISECONDS_IN_HOUR);
}
