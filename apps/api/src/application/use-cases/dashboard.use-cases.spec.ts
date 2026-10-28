import { beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_CHART_DAYS,
  GetDashboardChartsUseCase,
  MAX_CHART_DAYS,
} from '@/application/use-cases/get-dashboard-charts.use-case';
import {
  GetDashboardSummaryUseCase,
  toPercentage,
} from '@/application/use-cases/get-dashboard-summary.use-case';
import {
  InMemoryCaptureLogRepository,
  StubDashboardMetricsRepository,
} from '../../../test/factories/doubles';
import { FIXED_NOW } from '../../../test/factories/make-job';

describe('GetDashboardSummaryUseCase', () => {
  let metrics: StubDashboardMetricsRepository;
  let captureLogs: InMemoryCaptureLogRepository;
  let useCase: GetDashboardSummaryUseCase;

  beforeEach(() => {
    metrics = new StubDashboardMetricsRepository();
    captureLogs = new InMemoryCaptureLogRepository();
    useCase = new GetDashboardSummaryUseCase(metrics, captureLogs);
  });

  it('monta os quatro KPIs da janela de 72 horas', async () => {
    metrics.summary = {
      openJobs: 40,
      newInLast24h: 12,
      newInPrevious24h: 9,
      remoteJobs: 30,
      hiringCompanies: 17,
    };

    const summary = await useCase.execute(FIXED_NOW);

    expect(summary.windowInHours).toBe(72);
    expect(summary.openJobs.total).toBe(40);
    expect(summary.newInLast24h).toEqual({ total: 12, previousTotal: 9, delta: 3 });
    expect(summary.remote).toEqual({ total: 30, percentage: 75 });
    expect(summary.hiringCompanies.total).toBe(17);
  });

  it('informa delta negativo quando o fluxo cai', async () => {
    metrics.summary = { ...metrics.summary, newInLast24h: 4, newInPrevious24h: 11 };

    const summary = await useCase.execute(FIXED_NOW);

    expect(summary.newInLast24h.delta).toBe(-7);
  });

  it('expoe o cabecalho de ultima e proxima captura', async () => {
    const captureId = await captureLogs.start({
      startedAt: FIXED_NOW,
      nextRunAt: new Date(FIXED_NOW.getTime() + 7_200_000),
    });
    await captureLogs.finish({
      captureId,
      finishedAt: new Date(FIXED_NOW.getTime() + 30_000),
      status: 'PARTIAL',
      totalFound: 10,
      totalApproved: 5,
      totalRejected: 5,
      totalDuplicated: 1,
      totalPersisted: 4,
      failedSources: ['linkedin'],
    });

    const summary = await useCase.execute(FIXED_NOW);

    expect(summary.capture).toEqual({
      lastCaptureAt: new Date(FIXED_NOW.getTime() + 30_000),
      nextCaptureAt: new Date(FIXED_NOW.getTime() + 7_200_000),
      status: 'PARTIAL',
      failedSources: ['linkedin'],
    });
  });

  it('devolve cabecalho vazio quando nunca houve captura', async () => {
    const summary = await useCase.execute(FIXED_NOW);

    expect(summary.capture).toEqual({
      lastCaptureAt: null,
      nextCaptureAt: null,
      status: null,
      failedSources: [],
    });
  });

  it('usa o horario atual quando nenhuma referencia e informada', async () => {
    await expect(useCase.execute()).resolves.toMatchObject({ windowInHours: 72 });
  });
});

describe('toPercentage', () => {
  it.each([
    [30, 40, 75],
    [1, 3, 33.3],
    [0, 10, 0],
    [5, 0, 0],
  ])('calcula %s de %s como %s%%', (part, total, expected) => {
    expect(toPercentage(part, total)).toBe(expected);
  });
});

describe('GetDashboardChartsUseCase', () => {
  let metrics: StubDashboardMetricsRepository;
  let useCase: GetDashboardChartsUseCase;

  beforeEach(() => {
    metrics = new StubDashboardMetricsRepository();
    useCase = new GetDashboardChartsUseCase(metrics);
  });

  it('monta o grafico de rosca com quantidade e percentual por fonte', async () => {
    metrics.bySource = [
      { source: 'linkedin', total: 6 },
      { source: 'gupy', total: 2 },
      { source: 'remotar', total: 2 },
    ];

    const charts = await useCase.execute(DEFAULT_CHART_DAYS, FIXED_NOW);

    expect(charts.openJobsBySource).toEqual([
      { source: 'linkedin', total: 6, percentage: 60 },
      { source: 'gupy', total: 2, percentage: 20 },
      { source: 'remotar', total: 2, percentage: 20 },
    ]);
  });

  it('empilha as vagas novas por dia e fonte, em ordem cronologica', async () => {
    metrics.byDay = [
      { day: '2026-10-26', source: 'gupy', total: 1 },
      { day: '2026-10-25', source: 'gupy', total: 3 },
      { day: '2026-10-25', source: 'linkedin', total: 1 },
    ];

    const charts = await useCase.execute(14, FIXED_NOW);

    expect(charts.newJobsByDay).toEqual([
      {
        day: '2026-10-25',
        total: 4,
        sources: [
          { source: 'gupy', total: 3, percentage: 75 },
          { source: 'linkedin', total: 1, percentage: 25 },
        ],
      },
      {
        day: '2026-10-26',
        total: 1,
        sources: [{ source: 'gupy', total: 1, percentage: 100 }],
      },
    ]);
  });

  it('lista as fontes do periodo para a legenda', async () => {
    metrics.byDay = [
      { day: '2026-10-26', source: 'remotar', total: 1 },
      { day: '2026-10-25', source: 'gupy', total: 1 },
      { day: '2026-10-24', source: 'gupy', total: 2 },
    ];

    const charts = await useCase.execute(14, FIXED_NOW);

    expect(charts.sources).toEqual(['gupy', 'remotar']);
  });

  it('repassa o periodo solicitado ao repositorio', async () => {
    await useCase.execute(7, FIXED_NOW);

    expect(metrics.lastDaysArgument).toBe(7);
  });

  it.each([
    ['periodo padrao', undefined, DEFAULT_CHART_DAYS],
    ['zero', 0, 1],
    ['negativo', -5, 1],
    ['fracionario', 7.8, 7],
    ['acima do maximo', 500, MAX_CHART_DAYS],
    ['nao numerico', Number.NaN, DEFAULT_CHART_DAYS],
  ])('normaliza %s', async (_label, days, expected) => {
    const charts = await useCase.execute(days, FIXED_NOW);

    expect(charts.days).toBe(expected);
    expect(metrics.lastDaysArgument).toBe(expected);
  });

  it('devolve graficos vazios quando nao ha vagas', async () => {
    const charts = await useCase.execute(14, FIXED_NOW);

    expect(charts.openJobsBySource).toEqual([]);
    expect(charts.newJobsByDay).toEqual([]);
    expect(charts.sources).toEqual([]);
  });

  it('usa o horario atual quando nenhuma referencia e informada', async () => {
    await expect(useCase.execute()).resolves.toMatchObject({ days: DEFAULT_CHART_DAYS });
  });
});
