import type { Job } from '@/domain/entities/job';
import type { PublishedAtSource } from '@/domain/dtos/raw-job-props';
import type { JobScope } from '@/domain/services/job-scope';

export const JOB_WRITE_REPOSITORY = Symbol.for('JOB_WRITE_REPOSITORY');

/** Vaga aprovada pronta para persistir, com os metadados de captura. */
export interface PersistableJob {
  readonly job: Job;
  readonly publishedAtSource: PublishedAtSource;
  readonly recruiterName: string;
  readonly tags: readonly string[];
  /** Mercado da vaga, classificado no momento da captura. */
  readonly scope: JobScope;
}

export interface SaveJobsResult {
  /** Vagas inseridas pela primeira vez. */
  readonly created: number;
  /** Vagas que ja existiam (mesmo fingerprint) e tiveram apenas `lastSeenAt` atualizado. */
  readonly duplicated: number;
}

/**
 * Contrato de escrita da captura (ISP): nao expoe nenhuma leitura de metrica.
 */
export interface IJobWriteRepository {
  findExistingFingerprints(fingerprints: readonly string[]): Promise<string[]>;
  saveMany(jobs: readonly PersistableJob[]): Promise<SaveJobsResult>;
}
