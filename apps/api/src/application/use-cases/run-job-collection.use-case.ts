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
  SOURCE_HEALTH_WRITER,
  type ISourceHealthWriter,
} from '@/domain/repositories/source-health-repository';
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

export type CaptureReport = FinishCaptureInput & {
  readonly startedAt: Date;
  readonly nextRunAt: Date;
};

interface SourceOutcome {
  readonly source: string;
  readonly totalFound: number;
  readonly failed: boolean;
  readonly errorMessage?: string | undefined;
}

interface CollectedJobs {
  readonly raw: RawJobProps[];
  readonly failedSources: string[];
  readonly outcomes: SourceOutcome[];
  /** Fontes efetivamente visitadas neste ciclo — as adiadas nao contam. */
  readonly attempted: number;
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
    @Inject(SOURCE_HEALTH_WRITER) private readonly sourceHealth: ISourceHealthWriter,
  ) {}

  async execute(reference: Date = new Date()): Promise<CaptureReport> {
    // Proximo disparo real do cron, nao "agora + 2h".
    const nextRunAt = this.schedule.nextRunAt(reference);
    const captureId = await this.captureLogs.start({ startedAt: reference, nextRunAt });

    const { raw, failedSources, outcomes, attempted } = await this.collectFromSources(reference);

    // Registrado antes do filtro: a tabela de saude pergunta se a fonte
    // RESPONDEU, nao se o que ela trouxe foi aprovado.
    await this.sourceHealth.record(outcomes.map((o) => ({ ...o, captureId })));
    const approved = this.selectApproved(raw, reference);
    const fresh = await this.selectUnpublished(approved);
    const { created } = await this.jobs.saveMany(fresh);

    await this.notifyAll(fresh);

    const outcome: FinishCaptureInput = {
      captureId,
      finishedAt: new Date(),
      status: this.resolveStatus(failedSources.length, attempted),
      totalFound: raw.length,
      totalApproved: approved.length,
      totalRejected: raw.length - approved.length,
      totalDuplicated: approved.length - fresh.length,
      totalPersisted: created,
      failedSources,
      ...this.describeFailure(failedSources, attempted),
    };

    await this.captureLogs.finish(outcome);

    return { ...outcome, startedAt: reference, nextRunAt };
  }

  /**
   * `Promise.allSettled` garante que a falha de um site nao interrompa os demais.
   * Cada promessa carrega a sua fonte, por isso as que falharam sao justamente as
   * fontes sem resultado bem-sucedido — sem depender de indices paralelos.
   *
   * Fontes adiadas ficam de fora inteiras: nao sao visitadas, nao entram na
   * saude da coleta e nao contam para o status da captura. Uma fonte que
   * ninguem visitou nao esta falhando nem parada — ela so nao chegou a vez.
   */
  private async collectFromSources(reference: Date): Promise<CollectedJobs> {
    const due = await this.selectDueSources(reference);

    const settled = await Promise.allSettled(
      due.map(async (scraper) => ({
        source: scraper.source,
        jobs: await scraper.scrape(),
      })),
    );

    const raw: RawJobProps[] = [];
    const found = new Map<string, number>();

    for (const result of settled) {
      if (result.status === 'rejected') {
        this.logger.warn(`Uma fonte falhou na captura: ${describeError(result.reason)}`);

        continue;
      }

      found.set(result.value.source, result.value.jobs.length);
      raw.push(...result.value.jobs);
    }

    const outcomes = due.map((scraper) => ({
      source: scraper.source,
      totalFound: found.get(scraper.source) ?? 0,
      failed: !found.has(scraper.source),
    }));

    return {
      raw,
      failedSources: outcomes.filter((o) => o.failed).map((o) => o.source),
      outcomes,
      attempted: due.length,
    };
  }

  /**
   * Uma fonte que se recusa a responder se esta na hora e tratada como adiada:
   * perguntar custa nada e errar para menos so adia a coleta ate o proximo
   * ciclo, enquanto errar para mais gastaria cota de API.
   */
  private async selectDueSources(reference: Date): Promise<IJobScraperProvider[]> {
    // `async` de proposito: assim ate um coletor que estoure de forma sincrona
    // — ou que nem tenha o metodo — vira promessa rejeitada em vez de derrubar
    // a captura inteira antes de comecar.
    const answers = await Promise.allSettled(
      this.scrapers.map(async (scraper) => scraper.isDue(reference)),
    );

    return this.scrapers.filter((scraper, index) => {
      const answer = answers[index];

      if (answer?.status !== 'fulfilled') {
        this.logger.warn(`Fonte ${scraper.source} nao disse se esta na hora: adiada`);

        return false;
      }

      return answer.value;
    });
  }

  /** Converte para entidade e mantem apenas o que passa pelo motor de regras. */
  private selectApproved(raw: readonly RawJobProps[], reference: Date): PersistableJob[] {
    return raw.flatMap((props) => {
      const job = this.toJob(props, reference);

      if (!job) {
        return [];
      }

      const tags = props.tags ?? [];
      // As tags entram na avaliacao porque decidem o mercado: a Remotar marca
      // "Vaga internacional" ali, e nao no titulo nem na descricao.
      const evaluation = this.ruleEngine.evaluate(job, reference, {
        tags,
        ...(props.origin ? { origin: props.origin } : {}),
      });

      if (!evaluation.approved) {
        return [];
      }

      return [
        {
          job,
          publishedAtSource: props.publishedAtSource,
          recruiterName: props.recruiterName ?? '',
          tags,
          // Reaproveita o escopo que a avaliacao ja classificou, em vez de
          // classificar de novo: regra e coluna leem da mesma fonte.
          scope: evaluation.scope,
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

  /**
   * `FAILED` compara com as fontes VISITADAS, nao com o registro inteiro: num
   * ciclo em que so uma fonte estava na hora e ela caiu, a captura falhou por
   * completo, ainda que seis coletores adiados sigam saudaveis.
   */
  private resolveStatus(failedCount: number, attempted: number): CaptureStatus {
    if (failedCount === 0) {
      return 'SUCCESS';
    }

    return failedCount === attempted ? 'FAILED' : 'PARTIAL';
  }

  private describeFailure(
    failedSources: readonly string[],
    attempted: number,
  ): { errorMessage?: string } {
    if (failedSources.length === 0 || failedSources.length < attempted) {
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
