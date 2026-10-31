import { beforeEach, describe, expect, it } from 'vitest';

import { CloseFinishedJobsUseCase } from '@/application/use-cases/close-finished-jobs.use-case';
import type { IJobClosureProvider } from '@/domain/providers/job-closure-provider';
import {
  InMemoryJobClosureWriter,
  StubJobClosureProvider,
} from '../../../test/factories/doubles';
import { FIXED_NOW } from '../../../test/factories/make-job';

const ISSUE_1 = 'https://github.com/frontendbr/vagas/issues/1';
const ISSUE_2 = 'https://github.com/react-brasil/vagas/issues/2';

describe('CloseFinishedJobsUseCase', () => {
  let closures: InMemoryJobClosureWriter;

  beforeEach(() => {
    closures = new InMemoryJobClosureWriter();
  });

  it('encerra as vagas que a fonte declarou acabadas', async () => {
    const github = new StubJobClosureProvider('github', [ISSUE_1, ISSUE_2]);

    const report = await new CloseFinishedJobsUseCase([github], closures).execute(FIXED_NOW);

    expect(report.totalClosed).toBe(2);
    expect([...closures.closed.keys()]).toEqual([ISSUE_1, ISSUE_2]);
  });

  it('registra o momento do encerramento', async () => {
    const github = new StubJobClosureProvider('github', [ISSUE_1]);

    await new CloseFinishedJobsUseCase([github], closures).execute(FIXED_NOW);

    expect(closures.closed.get(ISSUE_1)).toBe(FIXED_NOW);
  });

  it('nao escreve nada quando nenhuma fonte tem encerramento', async () => {
    const github = new StubJobClosureProvider('github', []);

    const report = await new CloseFinishedJobsUseCase([github], closures).execute(FIXED_NOW);

    expect(report.totalClosed).toBe(0);
    expect(closures.closed.size).toBe(0);
  });

  it('nao repete a mesma url quando duas fontes a declaram', async () => {
    const providers = [
      new StubJobClosureProvider('github', [ISSUE_1]),
      new StubJobClosureProvider('outra', [ISSUE_1]),
    ];

    const report = await new CloseFinishedJobsUseCase(providers, closures).execute(FIXED_NOW);

    expect(report.totalClosed).toBe(1);
  });

  it('segue com as demais fontes quando uma falha, e a reporta', async () => {
    const providers = [
      new StubJobClosureProvider('github', new Error('403 rate limit')),
      new StubJobClosureProvider('outra', [ISSUE_2]),
    ];

    const report = await new CloseFinishedJobsUseCase(providers, closures).execute(FIXED_NOW);

    expect(report.totalClosed).toBe(1);
    expect(report.failedSources).toEqual(['github']);
  });

  it('reporta a fonte que rejeitou com algo que nao e Error', async () => {
    const quebrada: IJobClosureProvider = {
      source: 'outra',
      findClosedJobUrls: () => Promise.reject('403'),
    };

    const report = await new CloseFinishedJobsUseCase([quebrada], closures).execute(FIXED_NOW);

    expect(report).toEqual({ totalClosed: 0, failedSources: ['outra'] });
  });

  it('nao encerra de novo a vaga que ja estava encerrada', async () => {
    const github = new StubJobClosureProvider('github', [ISSUE_1]);
    const useCase = new CloseFinishedJobsUseCase([github], closures);

    await useCase.execute(FIXED_NOW);
    const segundo = await useCase.execute(FIXED_NOW);

    // O ciclo seguinte ve a mesma issue fechada na fonte; o que mudou de estado
    // foi zero, e a data registrada continua a do primeiro encerramento.
    expect(segundo.totalClosed).toBe(0);
  });

  it('funciona sem nenhuma fonte de encerramento registrada', async () => {
    const report = await new CloseFinishedJobsUseCase([], closures).execute(FIXED_NOW);

    expect(report).toEqual({ totalClosed: 0, failedSources: [] });
  });
});
