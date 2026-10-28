import { describe, expect, it } from 'vitest';

import { InvalidJobError } from '@/domain/errors/invalid-job-error';
import { JobFingerprint } from '@/domain/value-objects/job-fingerprint';

const EXPECTED_ACME_HASH = '549b4e9baae4aae7c95faced923fa966af7817d1e4da62cf8bfe1bcd5d8a74c3';

describe('JobFingerprint (value object)', () => {
  it('gera um hash sha-256 em hexadecimal', () => {
    const fingerprint = JobFingerprint.create('Acme Corp', 'Desenvolvedor Frontend React');

    expect(fingerprint.value).toMatch(/^[a-f0-9]{64}$/);
    expect(fingerprint.value).toBe(EXPECTED_ACME_HASH);
  });

  it('e deterministico para a mesma entrada', () => {
    const first = JobFingerprint.create('Acme Corp', 'Dev Fullstack');
    const second = JobFingerprint.create('Acme Corp', 'Dev Fullstack');

    expect(first.value).toBe(second.value);
  });

  it.each([
    ['caixa alta', 'ACME CORP', 'DESENVOLVEDOR FRONTEND REACT'],
    ['acentos', 'Ácmé Córp', 'Desenvolvedór Fróntend React'],
    ['espacos extras', '  Acme   Corp  ', ' Desenvolvedor  Frontend   React '],
    ['pontuacao', 'Acme-Corp.', 'Desenvolvedor | Frontend (React)'],
  ])('normaliza %s antes de gerar o hash', (_label, company, title) => {
    expect(JobFingerprint.create(company, title).value).toBe(EXPECTED_ACME_HASH);
  });

  it('gera hashes distintos para empresas diferentes', () => {
    const acme = JobFingerprint.create('Acme Corp', 'Dev Frontend');
    const globex = JobFingerprint.create('Globex', 'Dev Frontend');

    expect(acme.value).not.toBe(globex.value);
  });

  it('gera hashes distintos para titulos diferentes', () => {
    const frontend = JobFingerprint.create('Acme Corp', 'Dev Frontend');
    const backend = JobFingerprint.create('Acme Corp', 'Dev Backend');

    expect(frontend.value).not.toBe(backend.value);
  });

  it('nao confunde a fronteira entre empresa e titulo', () => {
    const first = JobFingerprint.create('Acme', 'CorpDev');
    const second = JobFingerprint.create('AcmeCorp', 'Dev');

    expect(first.value).not.toBe(second.value);
  });

  it('compara fingerprints por valor', () => {
    const first = JobFingerprint.create('Acme Corp', 'Dev Frontend');
    const second = JobFingerprint.create('acme corp', 'dev frontend');
    const other = JobFingerprint.create('Globex', 'Dev Frontend');

    expect(first.equals(second)).toBe(true);
    expect(first.equals(other)).toBe(false);
  });

  it('expoe o valor via toString', () => {
    const fingerprint = JobFingerprint.create('Acme Corp', 'Desenvolvedor Frontend React');

    expect(fingerprint.toString()).toBe(EXPECTED_ACME_HASH);
  });

  it.each([
    ['empresa vazia', '   ', 'Dev Frontend'],
    ['titulo vazio', 'Acme', '  '],
    ['empresa so com pontuacao', '---', 'Dev Frontend'],
    ['titulo so com pontuacao', 'Acme', '***'],
  ])('rejeita %s', (_label, company, title) => {
    expect(() => JobFingerprint.create(company, title)).toThrow(InvalidJobError);
  });

  it('restaura um fingerprint ja persistido', () => {
    const restored = JobFingerprint.restore(EXPECTED_ACME_HASH);

    expect(restored.value).toBe(EXPECTED_ACME_HASH);
  });

  it('rejeita a restauracao de um hash fora do formato sha-256', () => {
    expect(() => JobFingerprint.restore('abc123')).toThrow(InvalidJobError);
  });
});
