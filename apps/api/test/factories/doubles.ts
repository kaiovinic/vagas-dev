import type { RawJobProps } from '@/domain/dtos/raw-job-props';
import type { ICaptureSchedule } from '@/domain/providers/capture-schedule';
import type { IJobScraperProvider } from '@/domain/providers/job-scraper-provider';
import type {
  ISourceHealthRepository,
  ISourceHealthWriter,
  SourceHealth,
  SourceRunRecord,
} from '@/domain/repositories/source-health-repository';
import type {
  ITelegramNotifier,
  JobAlert,
  WeeklyDigest,
} from '@/domain/providers/telegram-notifier';
import type {
  FinishCaptureInput,
  ICaptureLogRepository,
  LastCaptureSnapshot,
  StartCaptureInput,
} from '@/domain/repositories/capture-log-repository';
import type {
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

import { hoursAgo } from './make-job';

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

  constructor(
    readonly source: string,
    private readonly result: RawJobProps[] | Error,
    readonly label: string = source,
  ) {}

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

export class FakeTelegramNotifier implements ITelegramNotifier {
  readonly notified: JobAlert[] = [];
  readonly digests: WeeklyDigest[] = [];
  shouldFail = false;

  async notifyNewJob(alert: JobAlert): Promise<void> {
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
