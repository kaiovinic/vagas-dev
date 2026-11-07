import type { RawJobProps } from '@/domain/dtos/raw-job-props';
import type { ICaptureSchedule } from '@/domain/providers/capture-schedule';
import type { IJobScraperProvider } from '@/domain/providers/job-scraper-provider';
import type {
  IOperationalAlerter,
  OperationalAlert,
} from '@/domain/providers/operational-alerter';
import type { IJobDescriptionFetcher } from '@/domain/providers/job-description-fetcher';
import type {
  FetchedDescription,
  IJobDescriptionReader,
  IJobDescriptionWriter,
  IMissingDescriptionRepository,
} from '@/domain/repositories/job-description-repository';
import type {
  ISourceHealthRepository,
  ISourceHealthWriter,
  ISourceLastRunReader,
  SourceHealth,
  SourceRunRecord,
} from '@/domain/repositories/source-health-repository';
import type {
  ITelegramNotifier,
  JobAlert,
  WeeklyDigest,
} from '@/domain/providers/telegram-notifier';
import type {
  IPendingAlertRepository,
  PendingJobAlert,
} from '@/domain/repositories/job-alert-repository';
import type {
  FinishCaptureInput,
  ICaptureLogRepository,
  LastCaptureSnapshot,
  StartCaptureInput,
} from '@/domain/repositories/capture-log-repository';
import type {
  CaptureBucketCount,
  DailySourceJobCount,
  IDashboardMetricsRepository,
  OpenJobsSummary,
  SourceJobCount,
} from '@/domain/repositories/dashboard-metrics-repository';
import type {
  HiringEntityCount,
  IJobQueryRepository,
  JobListFilters,
  JobListItem,
  PaginatedJobs,
} from '@/domain/repositories/job-query-repository';
import type {
  IJobWriteRepository,
  PersistableJob,
  SaveJobsResult,
} from '@/domain/repositories/job-write-repository';

import type { IJobClosureProvider } from '@/domain/providers/job-closure-provider';
import type { IJobClosureWriter } from '@/domain/repositories/job-closure-repository';
import type { CandidateProfile } from '@/domain/entities/candidate-profile';
import type { ICandidateProfileReader } from '@/domain/repositories/candidate-profile-repository';
import { ResumeGenerationFailedError } from '@/domain/errors/resume-errors';
import type {
  GeneratedResumeContent,
  IResumeGenerator,
  ResumeRequest,
  ResumeTargetJob,
} from '@/domain/providers/resume-generator';
import type {
  IResumeRepository,
  IResumeTargetJobReader,
  StoredResume,
} from '@/domain/repositories/resume-repository';
import { FIXED_NOW, hoursAgo } from './make-job';

export function rawJob(overrides: Partial<RawJobProps> = {}): RawJobProps {
  return {
    title: 'Desenvolvedor Frontend React',
    company: 'Acme Corp',
    source: 'gupy',
    url: 'https://gupy.io/vagas/1',
    publishedAt: hoursAgo(2),
    publishedAtSource: 'SOURCE',
    description: 'Vaga para atuar com React e TypeScript.',
    location: 'Salvador/BA',
    workModel: 'REMOTE',
    ...overrides,
  };
}

/** Agendamento previsivel: sempre o proximo horario par cheio apos a referencia. */
export class FakeCaptureSchedule implements ICaptureSchedule {
  nextRunAt(reference: Date): Date {
    const next = new Date(reference);

    next.setUTCMinutes(0, 0, 0);
    next.setUTCHours(next.getUTCHours() + (next.getUTCHours() % 2 === 0 ? 2 : 1));

    return next;
  }
}

export class StubScraperProvider implements IJobScraperProvider {
  calls = 0;
  /** `false` simula a fonte que ainda nao chegou a vez; `Error`, a que nem responde. */
  due: boolean | Error = true;
  dueCalls = 0;
  /** `false` simula a fonte sem credencial — a que vira no-op silencioso. */
  configured = true;

  constructor(
    readonly source: string,
    private readonly result: RawJobProps[] | Error,
    readonly label: string = source,
  ) {}

  async isDue(_reference: Date): Promise<boolean> {
    this.dueCalls += 1;

    if (this.due instanceof Error) {
      throw this.due;
    }

    return this.due;
  }

  isConfigured(): boolean {
    return this.configured;
  }

  async scrape(): Promise<RawJobProps[]> {
    this.calls += 1;

    if (this.result instanceof Error) {
      throw this.result;
    }

    return this.result;
  }
}

export class InMemoryJobWriteRepository implements IJobWriteRepository {
  readonly saved: PersistableJob[] = [];
  readonly saveCalls: readonly PersistableJob[][] = [];

  async findExistingFingerprints(fingerprints: readonly string[]): Promise<string[]> {
    const stored = new Set(this.saved.map((entry) => entry.job.fingerprint.value));

    return fingerprints.filter((fingerprint) => stored.has(fingerprint));
  }

  async saveMany(jobs: readonly PersistableJob[]): Promise<SaveJobsResult> {
    (this.saveCalls as PersistableJob[][]).push([...jobs]);

    const stored = new Set(this.saved.map((entry) => entry.job.fingerprint.value));
    const fresh = jobs.filter((entry) => !stored.has(entry.job.fingerprint.value));

    this.saved.push(...fresh);

    return { created: fresh.length, duplicated: jobs.length - fresh.length };
  }
}

export class InMemoryCaptureLogRepository implements ICaptureLogRepository {
  readonly started: StartCaptureInput[] = [];
  readonly finished: FinishCaptureInput[] = [];
  last: LastCaptureSnapshot | null = null;

  private sequence = 0;

  async start(input: StartCaptureInput): Promise<string> {
    this.started.push(input);
    this.sequence += 1;

    return `capture-${this.sequence}`;
  }

  async finish(input: FinishCaptureInput): Promise<void> {
    this.finished.push(input);
    this.last = {
      startedAt: this.started[this.started.length - 1]?.startedAt ?? input.finishedAt,
      finishedAt: input.finishedAt,
      nextRunAt: this.started[this.started.length - 1]?.nextRunAt ?? null,
      status: input.status,
      totalPersisted: input.totalPersisted,
      failedSources: input.failedSources,
    };
  }

  async findLastFinished(): Promise<LastCaptureSnapshot | null> {
    return this.last;
  }
}

export class InMemorySourceHealthWriter implements ISourceHealthWriter {
  readonly recorded: SourceRunRecord[] = [];

  async record(entries: readonly SourceRunRecord[]): Promise<void> {
    this.recorded.push(...entries);
  }
}

export class StubSourceHealthRepository implements ISourceHealthRepository {
  health: SourceHealth[] = [];
  lastQuery: { reference: Date; windowInHours: number } | null = null;

  async summarize(reference: Date, windowInHours: number): Promise<SourceHealth[]> {
    this.lastQuery = { reference, windowInHours };

    return this.health;
  }
}

export class StubSourceLastRunReader implements ISourceLastRunReader {
  /** `null` = a fonte nunca rodou. */
  lastRunAt: Date | null = null;
  readonly asked: string[] = [];

  async getLastRunAt(source: string): Promise<Date | null> {
    this.asked.push(source);

    return this.lastRunAt;
  }
}

export class FakeTelegramNotifier implements ITelegramNotifier {
  readonly notified: JobAlert[] = [];
  readonly digests: WeeklyDigest[] = [];
  shouldFail = false;
  /** Gancho para o teste observar o que ja tinha acontecido na hora do envio. */
  onNotify: (() => void) | undefined = undefined;

  async notifyNewJob(alert: JobAlert): Promise<void> {
    this.onNotify?.();

    if (this.shouldFail) {
      throw new Error('telegram indisponivel');
    }

    this.notified.push(alert);
  }

  async notifyWeeklyDigest(digest: WeeklyDigest): Promise<void> {
    if (this.shouldFail) {
      throw new Error('telegram indisponivel');
    }

    this.digests.push(digest);
  }
}

/**
 * Fila de alertas pendentes em memoria. `markNotified` tira da fila, como a
 * coluna `notifiedAt` faz no banco: o que saiu nao volta no proximo despacho.
 */
export class InMemoryPendingAlertRepository implements IPendingAlertRepository {
  pending: PendingJobAlert[] = [];
  readonly notifiedAt = new Map<string, Date>();

  async findPendingAlerts(_reference: Date, limit: number): Promise<PendingJobAlert[]> {
    return this.pending.slice(0, limit);
  }

  async markNotified(jobId: string, notifiedAt: Date): Promise<void> {
    this.notifiedAt.set(jobId, notifiedAt);
    this.pending = this.pending.filter((entry) => entry.jobId !== jobId);
  }
}

export class StubDashboardMetricsRepository implements IDashboardMetricsRepository {
  summary: OpenJobsSummary = {
    openJobs: 0,
    newInLast24h: 0,
    newInPrevious24h: 0,
    remoteJobs: 0,
    hiringCompanies: 0,
  };

  bySource: SourceJobCount[] = [];
  byDay: DailySourceJobCount[] = [];
  timeline: CaptureBucketCount[] = [];
  lastDaysArgument = 0;

  async getOpenJobsSummary(): Promise<OpenJobsSummary> {
    return this.summary;
  }

  async countOpenJobsBySource(): Promise<SourceJobCount[]> {
    return this.bySource;
  }

  async countJobsByDayAndSource(_reference: Date, days: number): Promise<DailySourceJobCount[]> {
    this.lastDaysArgument = days;

    return this.byDay;
  }

  async findCapturesTimeline24h(): Promise<CaptureBucketCount[]> {
    return this.timeline;
  }
}

export class StubJobQueryRepository implements IJobQueryRepository {
  items: JobListItem[] = [];
  companies: HiringEntityCount[] = [];
  recruiters: HiringEntityCount[] = [];
  lastFilters: JobListFilters | null = null;

  async list(filters: JobListFilters): Promise<PaginatedJobs> {
    this.lastFilters = filters;

    return {
      items: this.items,
      total: this.items.length,
      page: filters.page,
      perPage: filters.perPage,
    };
  }

  async countByCompany(): Promise<HiringEntityCount[]> {
    return this.companies;
  }

  async countByRecruiter(): Promise<HiringEntityCount[]> {
    return this.recruiters;
  }
}

export function jobListItem(overrides: Partial<JobListItem> = {}): JobListItem {
  return {
    id: 'job-1',
    fingerprint: 'a'.repeat(64),
    title: 'Desenvolvedor Frontend React',
    company: 'Acme Corp',
    recruiterName: null,
    source: 'gupy',
    city: 'Salvador/BA',
    isRemote: true,
    workModel: 'REMOTE',
    url: 'https://gupy.io/vagas/1',
    tags: ['React'],
    description: 'Vaga de teste para a listagem.',
    scope: 'NATIONAL',
    publishedAt: hoursAgo(2),
    publishedAtSource: 'SOURCE',
    ...overrides,
  };
}

/** Fonte que declara encerramentos: `closed` e o que ela vai devolver. */
export class StubJobClosureProvider implements IJobClosureProvider {
  calls = 0;

  constructor(
    readonly source: string,
    private readonly closed: readonly string[] | Error = [],
  ) {}

  async findClosedJobUrls(): Promise<readonly string[]> {
    this.calls += 1;

    if (this.closed instanceof Error) {
      throw this.closed;
    }

    return this.closed;
  }
}

/** Escrita de encerramento em memoria. */
export class InMemoryJobClosureWriter implements IJobClosureWriter {
  readonly closed = new Map<string, Date>();

  async closeByUrl(urls: readonly string[], closedAt: Date): Promise<number> {
    const novas = urls.filter((url) => !this.closed.has(url));

    for (const url of novas) {
      this.closed.set(url, closedAt);
    }

    return novas.length;
  }
}

/** Cache de descricao em memoria: o que ele "ja conhece" e o mapa `stored`. */
export class StubJobDescriptionReader implements IJobDescriptionReader {
  readonly stored = new Map<string, string>();
  /** Cada consulta recebida, para conferir que o coletor pergunta antes de ir a rede. */
  readonly asked: readonly string[][] = [];

  async findDescriptionsByUrl(urls: readonly string[]): Promise<ReadonlyMap<string, string>> {
    (this.asked as string[][]).push([...urls]);

    return new Map([...this.stored].filter(([url]) => urls.includes(url)));
  }
}

/**
 * Cache de escrita em memoria.
 *
 * `saved` guarda o que o coletor mandou gravar — inclusive a descricao de vaga
 * que as regras vao reprovar, que e justamente o ponto do cache.
 */
export class InMemoryJobDescriptionWriter implements IJobDescriptionWriter {
  readonly saved = new Map<string, string>();
  /** Erro a lancar na proxima escrita, para o teste de falha do banco. */
  failWith?: Error;

  async saveDescriptions(descriptions: readonly FetchedDescription[]): Promise<number> {
    if (this.failWith) {
      throw this.failWith;
    }

    for (const { url, description } of descriptions) {
      this.saved.set(url, description);
    }

    return descriptions.length;
  }
}

/** Busca de descricao avulsa: responde o que estiver em `descriptions`, vazio para o resto. */
export class StubJobDescriptionFetcher implements IJobDescriptionFetcher {
  readonly asked: string[] = [];

  constructor(
    readonly source: string,
    private readonly descriptions: Record<string, string> = {},
    private readonly failWith?: Error,
  ) {}

  async fetchDescriptionFor(url: string): Promise<string> {
    this.asked.push(url);

    if (this.failWith) {
      throw this.failWith;
    }

    return this.descriptions[url] ?? '';
  }
}

/**
 * As vagas abertas sem descricao, em memoria.
 *
 * `missing` e url -> fonte; o preenchimento tira de `missing` e poe em `filled`,
 * como o `updateMany` com `description: ''` faz no banco.
 */
export class InMemoryMissingDescriptionRepository implements IMissingDescriptionRepository {
  readonly missing = new Map<string, string>();
  readonly filled = new Map<string, string>();
  /** Janela recebida na ultima consulta, para conferir o recorte do feed. */
  askedFor?: { source: string; publishedAfter: Date; limit: number };
  /** Urls que outra captura preencheu entre a leitura e a escrita. */
  readonly raced = new Set<string>();
  failWith?: unknown;

  async findUrlsMissingDescription(
    source: string,
    publishedAfter: Date,
    limit: number,
  ): Promise<readonly string[]> {
    this.askedFor = { source, publishedAfter, limit };

    if (this.failWith) {
      throw this.failWith;
    }

    return [...this.missing]
      .filter(([, fonte]) => fonte === source)
      .map(([url]) => url)
      .slice(0, limit);
  }

  async fillDescriptionByUrl(url: string, description: string): Promise<number> {
    if (this.raced.has(url) || !this.missing.delete(url)) {
      return 0;
    }

    this.filled.set(url, description);

    return 1;
  }
}

export class InMemoryResumeTargetJobReader implements IResumeTargetJobReader {
  public jobs: ResumeTargetJob[] = [];

  async findById(jobId: string): Promise<ResumeTargetJob | null> {
    return this.jobs.find((job) => job.id === jobId) ?? null;
  }
}

export class InMemoryCandidateProfileReader implements ICandidateProfileReader {
  public profile: CandidateProfile | null = null;

  async find(): Promise<CandidateProfile | null> {
    return this.profile;
  }
}

export class InMemoryResumeRepository implements IResumeRepository {
  public saved: StoredResume[] = [];

  async save(jobId: string, content: GeneratedResumeContent): Promise<StoredResume> {
    const stored: StoredResume = {
      id: `resume-${this.saved.length + 1}`,
      jobId,
      markdown: content.markdown,
      rationale: content.rationale,
      gaps: content.gaps,
      model: content.usage.model,
      inputTokens: content.usage.inputTokens,
      outputTokens: content.usage.outputTokens,
      createdAt: FIXED_NOW,
    };

    this.saved.push(stored);

    return stored;
  }

  async findLatestByJob(jobId: string): Promise<StoredResume | null> {
    return [...this.saved].reverse().find((resume) => resume.jobId === jobId) ?? null;
  }
}

/**
 * Gerador dublado: devolve um curriculo fixo e registra o que recebeu, para o
 * teste conferir que o perfil e a vaga certos chegaram a porta.
 */
export class StubResumeGenerator implements IResumeGenerator {
  public requests: ResumeRequest[] = [];
  public shouldFail = false;
  public content: GeneratedResumeContent = {
    markdown: '# Kaio Vinicius',
    rationale: ['Destaquei React porque a vaga pede React.'],
    gaps: ['Nao tem experiencia com Angular.'],
    usage: {
      model: 'claude-opus-5-5',
      inputTokens: 2_900,
      outputTokens: 1_800,
      cacheReadTokens: 2_600,
      cacheCreationTokens: 0,
    },
  };

  async generate(request: ResumeRequest): Promise<GeneratedResumeContent> {
    this.requests.push(request);

    if (this.shouldFail) {
      throw new ResumeGenerationFailedError('provedor indisponivel');
    }

    return this.content;
  }
}

/**
 * Duplo da porta de alerta operacional.
 *
 * `shouldFail` existe para o teste que importa mais aqui: um alerta que nao sai
 * nao pode derrubar a captura.
 */
export class FakeOperationalAlerter implements IOperationalAlerter {
  readonly alerts: OperationalAlert[] = [];
  shouldFail = false;

  async notifyOperational(alert: OperationalAlert): Promise<void> {
    this.alerts.push(alert);

    if (this.shouldFail) {
      throw new Error('telegram fora do ar');
    }
  }
}
