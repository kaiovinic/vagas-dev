import { Injectable, Logger } from '@nestjs/common';
import type { JobScope, JobWorkModel } from '@prisma/client';

import { Job } from '@/domain/entities/job';
import type {
  IPendingAlertRepository,
  PendingJobAlert,
} from '@/domain/repositories/job-alert-repository';
import { PUBLICATION_WINDOW_IN_HOURS } from '@/domain/services/job-rule-engine';
import { OPEN_JOBS } from '@/infra/prisma/support/open-jobs';
import { PrismaService } from '@/infra/prisma/prisma.service';

const MILLISECONDS_IN_HOUR = 60 * 60 * 1000;

interface PendingRow {
  readonly id: string;
  readonly source: string;
  readonly title: string;
  readonly company: string;
  readonly city: string | null;
  readonly workModel: JobWorkModel;
  readonly scope: JobScope;
  readonly url: string;
  readonly description: string;
  readonly tags: string[];
  readonly publishedAt: Date;
}

/**
 * Fila de alertas pendentes lida do Postgres.
 *
 * A vaga ja guarda as tags e o mercado desde a captura, entao o alerta e
 * remontado da linha, sem reavaliar as regras: o que o leitor recebe agora e o
 * mesmo que receberia no ciclo em que a vaga entrou.
 */
@Injectable()
export class PrismaJobAlertRepository implements IPendingAlertRepository {
  private readonly logger = new Logger(PrismaJobAlertRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async findPendingAlerts(reference: Date, limit: number): Promise<PendingJobAlert[]> {
    const rows = await this.prisma.job.findMany({
      where: {
        ...OPEN_JOBS,
        notifiedAt: null,
        publishedAt: { gte: windowStart(reference), lte: reference },
      },
      orderBy: { publishedAt: 'asc' },
      take: limit,
      select: {
        id: true,
        source: true,
        title: true,
        company: true,
        city: true,
        workModel: true,
        scope: true,
        url: true,
        description: true,
        tags: true,
        publishedAt: true,
      },
    });

    const pending = rows.map((row) => this.toPendingAlert(row));

    await this.discardBroken(pending, reference);

    return pending.flatMap((entry) => (entry.alert === null ? [] : [entry.alert]));
  }

  async markNotified(jobId: string, notifiedAt: Date): Promise<void> {
    await this.prisma.job.update({ where: { id: jobId }, data: { notifiedAt } });
  }

  /** Linha que nao vira entidade fica de fora do lote, sem derrubar o despacho. */
  private toPendingAlert(row: PendingRow): { jobId: string; alert: PendingJobAlert | null } {
    try {
      return {
        jobId: row.id,
        alert: { jobId: row.id, alert: { job: toJob(row), tags: row.tags, scope: row.scope } },
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.warn(`Vaga ${row.id} nao virou alerta: ${message}`);

      return { jobId: row.id, alert: null };
    }
  }

  /**
   * Vaga com dado estragado e marcada como avisada de proposito: ela nunca vai
   * virar mensagem, e deixa-la pendente ocuparia uma vaga do lote a cada ciclo,
   * para sempre, atrasando as que tem conserto.
   */
  private async discardBroken(
    pending: readonly { jobId: string; alert: PendingJobAlert | null }[],
    reference: Date,
  ): Promise<void> {
    const broken = pending.filter((entry) => entry.alert === null);

    await Promise.all(broken.map((entry) => this.markNotified(entry.jobId, reference)));
  }
}

function toJob(row: PendingRow): Job {
  return Job.create({
    title: row.title,
    company: row.company,
    source: row.source,
    url: row.url,
    publishedAt: row.publishedAt,
    description: row.description,
    location: row.city ?? '',
    workModel: row.workModel,
  });
}

/** Mesma janela do feed: alerta de vaga fora dela nao interessa mais a ninguem. */
function windowStart(reference: Date): Date {
  return new Date(reference.getTime() - PUBLICATION_WINDOW_IN_HOURS * MILLISECONDS_IN_HOUR);
}
