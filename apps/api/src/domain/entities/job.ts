import { InvalidJobError } from '@/domain/errors/invalid-job-error';
import { JobFingerprint } from '@/domain/value-objects/job-fingerprint';

const MILLISECONDS_IN_HOUR = 60 * 60 * 1000;
const ALLOWED_URL_PROTOCOLS = ['http:', 'https:'];

export const JOB_WORK_MODELS = ['REMOTE', 'HYBRID', 'ONSITE', 'UNKNOWN'] as const;

export type JobWorkModel = (typeof JOB_WORK_MODELS)[number];

export interface CreateJobProps {
  readonly title: string;
  readonly company: string;
  readonly source: string;
  readonly url: string;
  readonly publishedAt: Date;
  readonly description?: string;
  readonly location?: string;
  readonly workModel?: JobWorkModel;
}

interface JobProps {
  readonly title: string;
  readonly company: string;
  readonly source: string;
  readonly url: string;
  readonly publishedAt: Date;
  readonly description: string;
  readonly location: string;
  readonly workModel: JobWorkModel;
}

/**
 * Entidade de dominio que representa uma vaga capturada e ja normalizada.
 * Nao conhece persistencia, HTTP nem nenhuma fonte especifica.
 */
export class Job {
  private constructor(
    private readonly props: JobProps,
    private readonly jobFingerprint: JobFingerprint,
  ) {}

  static create(props: CreateJobProps): Job {
    const title = requireText(props.title, 'title');
    const company = requireText(props.company, 'company');
    const normalized: JobProps = {
      title,
      company,
      source: requireText(props.source, 'source').toLowerCase(),
      url: requireHttpUrl(props.url),
      publishedAt: requireValidDate(props.publishedAt),
      description: props.description?.trim() ?? '',
      location: props.location?.trim() ?? '',
      workModel: requireWorkModel(props.workModel),
    };

    return new Job(normalized, JobFingerprint.create(company, title));
  }

  get title(): string {
    return this.props.title;
  }

  get company(): string {
    return this.props.company;
  }

  get source(): string {
    return this.props.source;
  }

  get url(): string {
    return this.props.url;
  }

  get description(): string {
    return this.props.description;
  }

  get location(): string {
    return this.props.location;
  }

  get workModel(): JobWorkModel {
    return this.props.workModel;
  }

  get publishedAt(): Date {
    return new Date(this.props.publishedAt.getTime());
  }

  get fingerprint(): JobFingerprint {
    return this.jobFingerprint;
  }

  /** Todo o texto relevante para a aplicacao das regras de filtragem. */
  get searchableText(): string {
    const { title, company, location, description } = this.props;

    return [title, company, location, description].join(' ');
  }

  ageInHours(reference: Date): number {
    return (reference.getTime() - this.props.publishedAt.getTime()) / MILLISECONDS_IN_HOUR;
  }

  equals(other: Job): boolean {
    return this.jobFingerprint.equals(other.fingerprint);
  }
}

function requireText(value: string, field: string): string {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new InvalidJobError(`${field} is required`);
  }

  return trimmed;
}

function requireHttpUrl(value: string): string {
  const trimmed = value.trim();
  const parsed = parseUrl(trimmed);

  if (!ALLOWED_URL_PROTOCOLS.includes(parsed.protocol)) {
    throw new InvalidJobError('url must use the http or https protocol');
  }

  return trimmed;
}

function parseUrl(value: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new InvalidJobError('url must be a valid absolute URL');
  }
}

function requireValidDate(value: Date): Date {
  if (Number.isNaN(value.getTime())) {
    throw new InvalidJobError('publishedAt must be a valid date');
  }

  return new Date(value.getTime());
}

function requireWorkModel(value: JobWorkModel | undefined): JobWorkModel {
  const workModel = value ?? 'UNKNOWN';

  if (!JOB_WORK_MODELS.includes(workModel)) {
    throw new InvalidJobError(`workModel must be one of: ${JOB_WORK_MODELS.join(', ')}`);
  }

  return workModel;
}
