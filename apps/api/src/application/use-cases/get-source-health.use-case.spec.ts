import { beforeEach, describe, expect, it } from 'vitest';

import {
  GetSourceHealthUseCase,
  SOURCE_HEALTH_WINDOW_IN_HOURS,
} from '@/application/use-cases/get-source-health.use-case';
import type { SourceHealth } from '@/domain/repositories/source-health-repository';
import { StubSourceHealthRepository } from '../../../test/factories/doubles';

describe('GetSourceHealthUseCase', () => {
  let repository: StubSourceHealthRepository;
  let useCase: GetSourceHealthUseCase;

  const reference = new Date('2026-10-30T12:00:00.000Z');

  beforeEach(() => {
    repository = new StubSourceHealthRepository();
    useCase = new GetSourceHealthUseCase(repository);
  });

  function health(overrides: Partial<SourceHealth> = {}): SourceHealth {
    return {
      source: 'gupy',
      lastRunAt: new Date('2026-10-30T11:50:00.000Z'),
      ok: true,
      runsInWindow: 12,
      failuresInWindow: 0,
      totalFoundInWindow: 59,
      ...overrides,
    };
  }

  it('consulta a janela de 24h a partir da referencia', async () => {
    await useCase.execute(reference);

    expect(repository.lastQuery).toEqual({
      reference,
      windowInHours: SOURCE_HEALTH_WINDOW_IN_HOURS,
    });
    expect(SOURCE_HEALTH_WINDOW_IN_HOURS).toBe(24);
  });

  it('expoe a linha da fonte com a proxima execucao e o intervalo', async () => {
    repository.health = [health()];

    const output = await useCase.execute(reference);

    expect(output).toEqual({
      windowInHours: 24,
      sources: [
        {
          source: 'gupy',
          status: 'OK',
          lastRunAt: '2026-10-30T11:50:00.000Z',
          nextRunAt: '2026-10-30T13:50:00.000Z',
          intervalInHours: 2,
          runs: 12,
          failures: 0,
          totalFound: 59,
        },
      ],
    });
  });

  it('usa o intervalo espacado das publicacoes sociais', async () => {
    repository.health = [health({ source: 'linkedin-posts', totalFoundInWindow: 5 })];

    const [row] = (await useCase.execute(reference)).sources;

    expect(row?.intervalInHours).toBe(4);
    expect(row?.nextRunAt).toBe('2026-10-30T15:50:00.000Z');
  });

  it('marca como FAILING quando a ultima execucao falhou', async () => {
    repository.health = [health({ ok: false, failuresInWindow: 3 })];

    const [row] = (await useCase.execute(reference)).sources;

    expect(row?.status).toBe('FAILING');
    expect(row?.failures).toBe(3);
  });

  // A licao do Jobbol: respondia 200 e nao trazia nada. "Ok" esconderia isso.
  it('marca como IDLE a fonte que rodou e nao trouxe nada', async () => {
    repository.health = [health({ totalFoundInWindow: 0 })];

    const [row] = (await useCase.execute(reference)).sources;

    expect(row?.status).toBe('IDLE');
  });

  it('nao chama de IDLE a fonte que ainda nao rodou na janela', async () => {
    repository.health = [
      health({ runsInWindow: 0, totalFoundInWindow: 0, lastRunAt: null }),
    ];

    const [row] = (await useCase.execute(reference)).sources;

    expect(row?.status).toBe('OK');
    expect(row?.lastRunAt).toBeNull();
    expect(row?.nextRunAt).toBeNull();
  });

  it('ordena pelas fontes que mais leem vagas', async () => {
    repository.health = [
      health({ source: 'gupy', totalFoundInWindow: 59 }),
      health({ source: 'nextcommit', totalFoundInWindow: 131 }),
      health({ source: 'linkedin-posts', totalFoundInWindow: 5 }),
    ];

    const output = await useCase.execute(reference);

    expect(output.sources.map((row) => row.source)).toEqual([
      'nextcommit',
      'gupy',
      'linkedin-posts',
    ]);
  });
});
