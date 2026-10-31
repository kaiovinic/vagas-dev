import { beforeEach, describe, expect, it } from 'vitest';

import {
  FillMissingDescriptionsUseCase,
  MAX_DESCRIPTIONS_FILLED_PER_CYCLE,
} from '@/application/use-cases/fill-missing-descriptions.use-case';
import {
  InMemoryJobDescriptionWriter,
  InMemoryMissingDescriptionRepository,
  StubJobDescriptionFetcher,
} from '../../../test/factories/doubles';

const VAGA = 'https://www.linkedin.com/jobs/view/4321';
const OUTRA = 'https://www.linkedin.com/jobs/view/8765';

describe('FillMissingDescriptionsUseCase', () => {
  let jobs: InMemoryMissingDescriptionRepository;
  let cache: InMemoryJobDescriptionWriter;

  beforeEach(() => {
    jobs = new InMemoryMissingDescriptionRepository();
    cache = new InMemoryJobDescriptionWriter();
  });

  function buildUseCase(fetchers: StubJobDescriptionFetcher[]): FillMissingDescriptionsUseCase {
    return new FillMissingDescriptionsUseCase(fetchers, jobs, cache);
  }

  it('busca o detalhe pela url e grava na vaga que estava vazia', async () => {
    jobs.missing.set(VAGA, 'linkedin');
    const linkedin = new StubJobDescriptionFetcher('linkedin', { [VAGA]: 'Vaga React' });

    const report = await buildUseCase([linkedin]).execute();

    expect(report).toEqual({ totalFilled: 1, failedSources: [] });
    expect(linkedin.asked).toEqual([VAGA]);
    expect(jobs.filled.get(VAGA)).toBe('Vaga React');
  });

  it('guarda a descricao tambem no cache, para o card nao custar outra requisicao', async () => {
    jobs.missing.set(VAGA, 'linkedin');

    await buildUseCase([new StubJobDescriptionFetcher('linkedin', { [VAGA]: 'Vaga React' })]).execute();

    expect(cache.saved.get(VAGA)).toBe('Vaga React');
  });

  it('nao grava nada quando a fonte nao descreve mais a vaga', async () => {
    jobs.missing.set(VAGA, 'linkedin');

    const report = await buildUseCase([new StubJobDescriptionFetcher('linkedin')]).execute();

    expect(report.totalFilled).toBe(0);
    expect(jobs.filled.size).toBe(0);
    // Descricao vazia no cache faria a vaga nunca ser tentada de novo.
    expect(cache.saved.size).toBe(0);
  });

  it('nao conta a vaga que outra captura preencheu antes', async () => {
    jobs.missing.set(VAGA, 'linkedin');
    // Linha ja preenchida: o `updateMany` nao encontra descricao vazia e muda zero.
    jobs.raced.add(VAGA);
    const linkedin = new StubJobDescriptionFetcher('linkedin', { [VAGA]: 'Vaga React' });

    const report = await buildUseCase([linkedin]).execute();

    expect(report.totalFilled).toBe(0);
  });

  it('pergunta a cada fonte apenas pelas vagas dela', async () => {
    jobs.missing.set(VAGA, 'linkedin');
    jobs.missing.set(OUTRA, 'gupy');
    const linkedin = new StubJobDescriptionFetcher('linkedin', { [VAGA]: 'React' });
    const gupy = new StubJobDescriptionFetcher('gupy', { [OUTRA]: 'Node' });

    const report = await buildUseCase([linkedin, gupy]).execute();

    expect(report.totalFilled).toBe(2);
    expect(linkedin.asked).toEqual([VAGA]);
    expect(gupy.asked).toEqual([OUTRA]);
  });

  it('respeita o teto informado, para o residuo acumulado nao virar rajada', async () => {
    const descriptions: Record<string, string> = {};

    for (let indice = 0; indice < 5; indice += 1) {
      const url = `https://www.linkedin.com/jobs/view/${indice}`;

      jobs.missing.set(url, 'linkedin');
      descriptions[url] = 'Vaga React';
    }

    const linkedin = new StubJobDescriptionFetcher('linkedin', descriptions);

    const report = await buildUseCase([linkedin]).execute(2);

    expect(report.totalFilled).toBe(2);
    expect(linkedin.asked).toHaveLength(2);
  });

  it('uma fonte que falha e reportada sem impedir as demais', async () => {
    jobs.missing.set(VAGA, 'linkedin');
    jobs.missing.set(OUTRA, 'gupy');
    const linkedin = new StubJobDescriptionFetcher('linkedin', {}, new Error('429 rate limit'));
    const gupy = new StubJobDescriptionFetcher('gupy', { [OUTRA]: 'Node' });

    const report = await buildUseCase([linkedin, gupy]).execute();

    expect(report).toEqual({ totalFilled: 1, failedSources: ['linkedin'] });
    expect(jobs.filled.get(OUTRA)).toBe('Node');
  });

  it('a falha de leitura do banco nao derruba o ciclo', async () => {
    jobs.failWith = new Error('conexao encerrada');
    const linkedin = new StubJobDescriptionFetcher('linkedin');

    const report = await buildUseCase([linkedin]).execute();

    expect(report).toEqual({ totalFilled: 0, failedSources: ['linkedin'] });
    expect(linkedin.asked).toHaveLength(0);
  });

  it('reporta a falha que nao e Error', async () => {
    jobs.failWith = '403';

    const report = await buildUseCase([new StubJobDescriptionFetcher('linkedin')]).execute();

    expect(report.failedSources).toEqual(['linkedin']);
  });

  it('nao vai ao banco quando nao existe fonte capaz de buscar detalhe', async () => {
    const report = await buildUseCase([]).execute();

    expect(report).toEqual({ totalFilled: 0, failedSources: [] });
  });

  it('o teto padrao cobre o residuo medido em producao', () => {
    expect(MAX_DESCRIPTIONS_FILLED_PER_CYCLE).toBeGreaterThanOrEqual(9);
  });
});
