import { createHash } from 'node:crypto';

import { InvalidJobError } from '@/domain/errors/invalid-job-error';
import { normalizeForFingerprint } from '@/domain/value-objects/text-normalizer';

const SHA256_HEX = /^[a-f0-9]{64}$/;
const FIELD_SEPARATOR = '|';

/**
 * Identidade natural de uma vaga: hash SHA-256 de `empresa + titulo` normalizados.
 * Permite deduplicar a mesma vaga publicada em fontes diferentes.
 */
export class JobFingerprint {
  private constructor(private readonly hash: string) {}

  static create(company: string, title: string): JobFingerprint {
    const normalizedCompany = normalizeForFingerprint(company);
    const normalizedTitle = normalizeForFingerprint(title);

    if (normalizedCompany.length === 0) {
      throw new InvalidJobError('company must contain alphanumeric characters for a fingerprint');
    }

    if (normalizedTitle.length === 0) {
      throw new InvalidJobError('title must contain alphanumeric characters for a fingerprint');
    }

    const seed = `${normalizedCompany}${FIELD_SEPARATOR}${normalizedTitle}`;

    return new JobFingerprint(createHash('sha256').update(seed).digest('hex'));
  }

  static restore(hash: string): JobFingerprint {
    if (!SHA256_HEX.test(hash)) {
      throw new InvalidJobError('fingerprint must be a lowercase sha-256 hex digest');
    }

    return new JobFingerprint(hash);
  }

  get value(): string {
    return this.hash;
  }

  equals(other: JobFingerprint): boolean {
    return this.hash === other.value;
  }

  toString(): string {
    return this.hash;
  }
}
