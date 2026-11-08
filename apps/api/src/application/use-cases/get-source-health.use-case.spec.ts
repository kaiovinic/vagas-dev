import { beforeEach, describe, expect, it } from 'vitest';

import {
  GetSourceHealthUseCase,
  SOURCE_HEALTH_WINDOW_IN_HOURS,
} from '@/application/use-cases/get-source-health.use-case';
import type { SourceHealth } from '@/domain/repositories/source-health-repository';
import { StubScraperProvider, StubSourceHealthRepository } from '../../../test/factories/doubles';

describe('GetSourceHealthUseCase', () => {
  let repository: StubSourceHealthRepository;
  let scrapers: StubScraperProvider[];

  const reference = new Date('2026-10-30T12:00:00.000Z');

  beforeEach(() => {
    repository = new StubSourceHealthRepository();
    scrapers = [];
  });

  /** Os coletores registrados entram caso a caso: cada teste diz quais existem. */
  function useCase(): GetSourceHealthUseCase {
    return new GetSourceHealthUseCase(repository, scrapers);
  }

  function scraper(source: string, configured = true): StubScraperProvider {
    const stub = new StubScraperProvider(source, []);
    stub.configured = configured;

    return stub;
  }

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
    await useCase().execute(reference);

    expect(repository.lastQuery).toEqual({
      reference,
      windowInHours: SOURCE_HEALTH_WINDOW_IN_HOURS,
    });
    expect(SOURCE_HEALTH_WINDOW_IN_HOURS).toBe(24);
  });

  it('expoe a linha da fonte com a proxima execucao e o intervalo', async () => {
    repository.health = [health()];

    const output = await useCase().execute(reference);

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

    const [row] = (await useCase().execute(reference)).sources;

    expect(row?.intervalInHours).toBe(4);
    expect(row?.nextRunAt).toBe('2026-10-30T15:50:00.000Z');
  });

  it('marca como FAILING quando a ultima execucao falhou', async () => {
    repository.health = [health({ ok: false, failuresInWindow: 3 })];

    const [row] = (await useCase().execute(reference)).sources;

    expect(row?.status).toBe('FAILING');
    expect(row?.failures).toBe(3);
  });

  // A licao do Jobbol: respondia 200 e nao trazia nada. "Ok" esconderia isso.
  it('marca como IDLE a fonte que rodou e nao trouxe nada', async () => {
    repository.health = [health({ totalFoundInWindow: 0 })];

    const [row] = (await useCase().execute(reference)).sources;

    expect(row?.status).toBe('IDLE');
  });

  it('ordena pelas fontes que mais leem vagas', async () => {
    repository.health = [
      health({ source: 'gupy', totalFoundInWindow: 59 }),
      health({ source: 'nextcommit', totalFoundInWindow: 131 }),
      health({ source: 'linkedin-posts', totalFoundInWindow: 5 }),
    ];

    const output = await useCase().execute(reference);

    expect(output.sources.map((row) => row.source)).toEqual([
      'nextcommit',
      'gupy',
      'linkedin-posts',
    ]);
  });

  /**
   * O incidente que trouxe estes dois estados: um `SERP_ENDPOINT` vazio no
   * container deixou o coletor de publicacoes cinco dias fora do ar. Ele nao
   * falhava — nunca era visitado —, e a tabela o mostrava verde. O alarme veio
   * do painel de credito do fornecedor, nao do nosso.
   */
  describe('fonte sem credencial', () => {
    it('nao e OK: e UNCONFIGURED', async () => {
      repository.health = [health({ source: 'linkedin-posts', totalFoundInWindow: 5 })];
      scrapers = [scraper('linkedin-posts', false)];

      const [row] = (await useCase().execute(reference)).sources;

      expect(row?.status).toBe('UNCONFIGURED');
    });

    /** Falta de credencial explica a falha; mostrar "falhando" esconderia a causa. */
    it('vale mais que FAILING, porque e a causa', async () => {
      repository.health = [health({ source: 'linkedin-posts', ok: false })];
      scrapers = [scraper('linkedin-posts', false)];

      const [row] = (await useCase().execute(reference)).sources;

      expect(row?.status).toBe('UNCONFIGURED');
    });

    it('segue OK quando o coletor diz que tem o que precisa', async () => {
      repository.health = [health()];
      scrapers = [scraper('gupy')];

      const [row] = (await useCase().execute(reference)).sources;

      expect(row?.status).toBe('OK');
    });

    /**
     * Jobbol, Solides e Coodesh seguem no historico e fora do registro. Dizer
     * que falta credencial a eles seria mentir sobre o motivo: eles estao
     * parados, e `INACTIVE` e o que sao.
     */
    it('fonte desligada do registro nao e acusada de falta de credencial', async () => {
      repository.health = [
        health({
          source: 'jobbol',
          lastRunAt: new Date('2026-10-29T06:00:00.000Z'),
          runsInWindow: 0,
          totalFoundInWindow: 0,
        }),
      ];

      const [row] = (await useCase().execute(reference)).sources;

      expect(row?.status).toBe('INACTIVE');
    });
  });

  describe('fonte que passou da hora', () => {
    it('e INACTIVE quando nao rodou na janela e a hora dela ja passou', async () => {
      repository.health = [
        health({
          // Rodou ha 30h: fora da janela de 24h, e a vez dela era 28h atras.
          lastRunAt: new Date('2026-10-29T06:00:00.000Z'),
          runsInWindow: 0,
          totalFoundInWindow: 0,
        }),
      ];

      const [row] = (await useCase().execute(reference)).sources;

      expect(row?.status).toBe('INACTIVE');
    });

    /** A fonte que nunca rodou e o caso mais grave de atraso, nao o mais leve. */
    it('e INACTIVE quando nunca rodou', async () => {
      repository.health = [health({ runsInWindow: 0, totalFoundInWindow: 0, lastRunAt: null })];

      const [row] = (await useCase().execute(reference)).sources;

      expect(row?.status).toBe('INACTIVE');
      expect(row?.lastRunAt).toBeNull();
      expect(row?.nextRunAt).toBeNull();
    });

    it('nao acusa de inativa a fonte que ainda esta dentro do intervalo', async () => {
      repository.health = [
        health({
          lastRunAt: new Date('2026-10-30T11:30:00.000Z'),
          runsInWindow: 0,
          totalFoundInWindow: 0,
        }),
      ];

      const [row] = (await useCase().execute(reference)).sources;

      expect(row?.status).toBe('OK');
    });
  });

  /**
   * O pior caso que havia: a fonte mais quebrada de todas era a unica que nao
   * aparecia. A tabela era montada a partir das execucoes, e quem nunca
   * executou nao tem nenhuma.
   */
  describe('coletor registrado que o banco nao conhece', () => {
    it('aparece na tabela mesmo sem nenhuma execucao', async () => {
      repository.health = [health()];
      scrapers = [scraper('gupy'), scraper('linkedin-auth-posts')];

      const output = await useCase().execute(reference);

      expect(output.sources.map((row) => row.source)).toContain('linkedin-auth-posts');
    });

    it('entra com os contadores zerados e sem data', async () => {
      scrapers = [scraper('linkedin-auth-posts')];

      const [row] = (await useCase().execute(reference)).sources;

      expect(row).toEqual({
        source: 'linkedin-auth-posts',
        status: 'INACTIVE',
        lastRunAt: null,
        nextRunAt: null,
        intervalInHours: 8,
        runs: 0,
        failures: 0,
        totalFound: 0,
      });
    });

    it('aparece como UNCONFIGURED quando falta a configuracao dele', async () => {
      scrapers = [scraper('linkedin-auth-posts', false)];

      const [row] = (await useCase().execute(reference)).sources;

      expect(row?.status).toBe('UNCONFIGURED');
    });

    it('nao duplica a fonte que o banco ja conhece', async () => {
      repository.health = [health()];
      scrapers = [scraper('gupy')];

      const output = await useCase().execute(reference);

      expect(output.sources).toHaveLength(1);
    });
  });
});
