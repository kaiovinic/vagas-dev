import { Inject, Injectable, Logger } from '@nestjs/common';

import type { RawJobProps } from '@/domain/dtos/raw-job-props';
import { Job } from '@/domain/entities/job';
import {
  JOB_SCRAPERS,
  type IJobScraperProvider,
} from '@/domain/providers/job-scraper-provider';
import {
  CAPTURE_SCHEDULE,
  type ICaptureSchedule,
} from '@/domain/providers/capture-schedule';
import {
  TELEGRAM_NOTIFIER,
  type ITelegramNotifier,
} from '@/domain/providers/telegram-notifier';
import {
  CAPTURE_LOG_REPOSITORY,
  type CaptureStatus,
  type FinishCaptureInput,
  type ICaptureLogRepository,
} from '@/domain/repositories/capture-log-repository';
import {
  JOB_WRITE_REPOSITORY,
  type IJobWriteRepository,
  type PersistableJob,
} from '@/domain/repositories/job-write-repository';
import { JobRuleEngine } from '@/domain/services/job-rule-engine';
import { classifyJobScope } from '@/domain/services/job-scope';

export type CaptureReport = FinishCaptureInput & {
  readonly startedAt: Date;
  readonly nextRunAt: Date;
};

interface CollectedJobs {
  readonly raw: RawJobProps[];
  readonly failedSources: string[];
}

/**
 * Orquestra uma rodada de captura: executa todos os coletores em paralelo,
 * aplica as regras do dominio, deduplica, persiste somente o que e inedito,
 * notifica no Telegram e registra a execucao no CaptureLog.
 *
 * Depende apenas de abstracoes do dominio (DIP) e nao conhece nenhuma fonte
 * concreta: adicionar um coletor novo e registrar mais um provider em
 * `JOB_SCRAPERS` (OCP).
 */
@Injectable()
export class RunJobCollectionUseCase {
  private readonly logger = new Logger(RunJobCollectionUseCase.name);

  constructor(
    @Inject(JOB_SCRAPERS) private readonly scrapers: readonly IJobScraperProvider[],
    private readonly ruleEngine: JobRuleEngine,
    @Inject(JOB_WRITE_REPOSITORY) private readonly jobs: IJobWriteRepository,
    @Inject(CAPTURE_LOG_REPOSITORY) private readonly captureLogs: ICaptureLogRepository,
    @Inject(TELEGRAM_NOTIFIER) private readonly notifier: ITelegramNotifier,
    @Inject(CAPTURE_SCHEDULE) private readonly schedule: ICaptureSchedule,
  ) {}

  async execute(reference: Date = new Date()): Promise<CaptureReport> {
    // Proximo disparo real do cron, nao "agora + 2h".
    const nextRunAt = this.schedule.nextRunAt(reference);
    const captureId = await this.captureLogs.start({ startedAt: reference, nextRunAt });

    const { raw, failedSources } = await this.collectFromSources();
    const approved = this.selectApproved(raw, reference);
    const fresh = await this.selectUnpublished(approved);
    const { created } = await this.jobs.saveMany(fresh);

    await this.notifyAll(fresh);

    const outcome: FinishCaptureInput = {
      captureId,
      finishedAt: new Date(),
      status: this.resolveStatus(failedSources.length),
      totalFound: raw.length,
      totalApproved: approved.length,
      totalRejected: raw.length - approved.length,
      totalDuplicated: approved.length - fresh.length,
      totalPersisted: created,
      failedSources,
      ...this.describeFailure(failedSources),
    };

    await this.captureLogs.finish(outcome);

    return { ...outcome, startedAt: reference, nextRunAt };
  }

  /**
   * `Promise.allSettled` garante que a falha de um site nao interrompa os demais.
   * Cada promessa carrega a sua fonte, por isso as que falharam sao justamente as
   * fontes sem resultado bem-sucedido — sem depender de indices paralelos.
   */
  private async collectFromSources(): Promise<CollectedJobs> {
    const settled = await Promise.allSettled(
      this.scrapers.map(async (scraper) => ({
        source: scraper.source,
        jobs: await scraper.scrape(),
      })),
    );

    const raw: RawJobProps[] = [];
    const succeeded = new Set<string>();

    for (const result of settled) {
      if (result.status === 'rejected') {
        this.logger.warn(`Uma fonte falhou na captura: ${describeError(result.reason)}`);

        continue;
      }

      succeeded.add(result.value.source);
      raw.push(...result.value.jobs);
    }

    const failedSources = this.scrapers
      .map((scraper) => scraper.source)
      .filter((source) => !succeeded.has(source));

    return { raw, failedSources };
  }

  /** Converte para entidade e mantem apenas o que passa pelo motor de regras. */
  private selectApproved(raw: readonly RawJobProps[], reference: Date): PersistableJob[] {
    return raw.flatMap((props) => {
      const job = this.toJob(props, reference);

      if (!job || !this.ruleEngine.isApproved(job, reference)) {
        return [];
      }

      const tags = props.tags ?? [];

      return [
        {
          job,
          publishedAtSource: props.publishedAtSource,
          recruiterName: props.recruiterName ?? '',
          tags,
          scope: classifyJobScope({
            title: job.title,
            description: job.description,
            location: job.location,
            tags,
          }),
        },
      ];
    });
  }

  private toJob(props: RawJobProps, reference: Date): Job | undefined {
    try {
      return Job.create({
        title: props.title,
        company: props.company,
        source: props.source,
        url: props.url,
        // Fontes sem data publicada (ex.: ProgramaThor) herdam o instante da captura.
        publishedAt: props.publishedAt ?? reference,
        description: props.description ?? '',
        location: props.location ?? '',
        workModel: props.workModel ?? 'UNKNOWN',
      });
    } catch (error: unknown) {
      this.logger.debug(`Vaga descartada por dados invalidos: ${describeError(error)}`);

      return undefined;
    }
  }

  /** Remove duplicatas do proprio lote e as que o banco ja conhece. */
  private async selectUnpublished(approved: readonly PersistableJob[]): Promise<PersistableJob[]> {
    const unique = dedupeByFingerprint(approved);
    const known = new Set(
      await this.jobs.findExistingFingerprints(unique.map((entry) => entry.job.fingerprint.value)),
    );

    return unique.filter((entry) => !known.has(entry.job.fingerprint.value));
  }

  /** Uma falha no Telegram nao invalida a captura: a vaga ja esta persistida. */
  private async notifyAll(jobs: readonly PersistableJob[]): Promise<void> {
    const settled = await Promise.allSettled(
      jobs.map((entry) =>
        this.notifier.notifyNewJob({
          job: entry.job,
          tags: entry.tags,
          scope: entry.scope,
        }),
      ),
    );

    const failures = settled.filter((result) => result.status === 'rejected').length;

    if (failures > 0) {
      this.logger.warn(`${failures} notificacao(oes) do Telegram falharam`);
    }
  }

  private resolveStatus(failedCount: number): CaptureStatus {
    if (failedCount === 0) {
      return 'SUCCESS';
    }

    return failedCount === this.scrapers.length ? 'FAILED' : 'PARTIAL';
  }

  private describeFailure(failedSources: readonly string[]): { errorMessage?: string } {
    if (failedSources.length === 0 || failedSources.length < this.scrapers.length) {
      return {};
    }

    return { errorMessage: `Todas as ${failedSources.length} fontes falharam` };
  }
}

function dedupeByFingerprint(jobs: readonly PersistableJob[]): PersistableJob[] {
  const seen = new Set<string>();

  return jobs.filter((entry) => {
    const fingerprint = entry.job.fingerprint.value;

    if (seen.has(fingerprint)) {
      return false;
    }

    seen.add(fingerprint);

    return true;
  });
}


function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
