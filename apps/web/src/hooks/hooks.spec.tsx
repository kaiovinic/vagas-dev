import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import {
  CHARTS_STALE_TIME_MS,
  CHART_DAY_OPTIONS,
  DEFAULT_CHART_DAYS,
  dashboardChartsQueryKey,
  useDashboardCharts,
} from '@/hooks/use-dashboard-charts';
import {
  SUMMARY_REFETCH_INTERVAL_MS,
  SUMMARY_STALE_TIME_MS,
  useDashboardSummary,
} from '@/hooks/use-dashboard-summary';
import { JOBS_STALE_TIME_MS, jobsListQueryKey, useJobsList } from '@/hooks/use-jobs-list';
import { sourceHealthQueryKey, useSourceHealth } from '@/hooks/use-source-health';
import { createTestQueryClient, jsonResponse } from '../../test/render';

const SUMMARY_PAYLOAD = {
  windowInHours: 72,
  capture: {
    lastCaptureAt: '2026-10-26T12:00:00.000Z',
    nextCaptureAt: '2026-10-26T14:00:00.000Z',
    status: 'SUCCESS',
    failedSources: [],
  },
  openJobs: { total: 40 },
  newInLast24h: { total: 12, previousTotal: 9, delta: 3 },
  remote: { total: 30, percentage: 75 },
  hiringCompanies: { total: 17 },
};

function chartsPayload(days: number): unknown {
  return {
    days,
    windowInHours: 72,
    sources: ['gupy'],
    openJobsBySource: [{ source: 'gupy', total: 4, percentage: 100 }],
    newJobsByDay: [
      { day: '2026-10-25', total: 4, sources: [{ source: 'gupy', total: 4, percentage: 100 }] },
    ],
  };
}

const JOBS_PAYLOAD = {
  items: [],
  total: 0,
  page: 1,
  perPage: 20,
  totalPages: 0,
};

function wrapper(): ({ children }: { children: ReactNode }) => ReactElement {
  const queryClient = createTestQueryClient();

  return function Wrapper({ children }): ReactElement {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function stubFetch(resolve: (url: string) => unknown): ReturnType<typeof vi.fn> {
  const spy = vi.fn((url: string) => Promise.resolve(jsonResponse(resolve(url))));

  vi.stubGlobal('fetch', spy);

  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useDashboardSummary', () => {
  it('consome /api/dashboard/summary e devolve os dados tipados', async () => {
    stubFetch(() => SUMMARY_PAYLOAD);

    const { result } = renderHook(() => useDashboardSummary(), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.openJobs.total).toBe(40);
    expect(result.current.data?.capture.status).toBe('SUCCESS');
  });

  it('chama exatamente a rota do resumo', async () => {
    const spy = stubFetch(() => SUMMARY_PAYLOAD);

    const { result } = renderHook(() => useDashboardSummary(), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy.mock.calls[0]?.[0]).toBe('/api/dashboard/summary');
  });

  it('atualiza sozinho a cada minuto', () => {
    expect(SUMMARY_REFETCH_INTERVAL_MS).toBe(60_000);
    expect(SUMMARY_STALE_TIME_MS).toBe(30_000);
  });

  it('expoe o erro quando o contrato quebra', async () => {
    stubFetch(() => ({ windowInHours: 'setenta e duas' }));

    const { result } = renderHook(() => useDashboardSummary(), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.name).toBe('ApiContractError');
  });
});

describe('useDashboardCharts', () => {
  it('oferece os periodos de 7, 14 e 30 dias, com 14 como padrao', () => {
    expect(CHART_DAY_OPTIONS).toEqual([7, 14, 30]);
    expect(DEFAULT_CHART_DAYS).toBe(14);
  });

  it('consome /api/dashboard/charts com o periodo na query string', async () => {
    const spy = stubFetch(() => chartsPayload(14));

    const { result } = renderHook(() => useDashboardCharts(14), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy.mock.calls[0]?.[0]).toBe('/api/dashboard/charts?days=14');
  });

  it('usa o periodo na chave de cache, para cada um ter o seu', () => {
    expect(dashboardChartsQueryKey(7)).toEqual(['dashboard', 'charts', 7]);
    expect(dashboardChartsQueryKey(30)).not.toEqual(dashboardChartsQueryKey(7));
  });

  it('mantem os dados anteriores ao trocar o seletor de dias', async () => {
    stubFetch((url) => chartsPayload(url.includes('days=30') ? 30 : 14));
    const Wrapper = wrapper();

    const { result, rerender } = renderHook(({ days }: { days: number }) => useDashboardCharts(days), {
      wrapper: Wrapper,
      initialProps: { days: 14 },
    });

    await waitFor(() => expect(result.current.data?.days).toBe(14));

    rerender({ days: 30 });

    // Enquanto 30 dias carrega, os dados de 14 continuam na tela.
    expect(result.current.data?.days).toBe(14);
    expect(result.current.isPending).toBe(false);
    expect(result.current.isPlaceholderData).toBe(true);

    await waitFor(() => expect(result.current.data?.days).toBe(30));
    expect(result.current.isPlaceholderData).toBe(false);
  });

  it('mantem os agregados frescos por 5 minutos', () => {
    expect(CHARTS_STALE_TIME_MS).toBe(300_000);
  });
});

describe('useJobsList', () => {
  it('consome /api/jobs sem filtros', async () => {
    const spy = stubFetch(() => JOBS_PAYLOAD);

    const { result } = renderHook(() => useJobsList(), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy.mock.calls[0]?.[0]).toBe('/api/jobs');
  });

  it('repassa os filtros na query string', async () => {
    const spy = stubFetch(() => JOBS_PAYLOAD);

    const { result } = renderHook(
      () =>
        useJobsList({
          search: 'react',
          source: 'gupy',
          isRemote: true,
          page: 2,
          perPage: 10,
          sortBy: 'company',
          sortDirection: 'asc',
        }),
      { wrapper: wrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const url = String(spy.mock.calls[0]?.[0]);

    expect(url).toContain('search=react');
    expect(url).toContain('source=gupy');
    expect(url).toContain('isRemote=true');
    expect(url).toContain('page=2');
    expect(url).toContain('perPage=10');
    expect(url).toContain('sortBy=company');
    expect(url).toContain('sortDirection=asc');
  });

  it('serializa a flag falsa em vez de omitir', async () => {
    const spy = stubFetch(() => JOBS_PAYLOAD);

    const { result } = renderHook(() => useJobsList({ isRemote: false }), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(String(spy.mock.calls[0]?.[0])).toContain('isRemote=false');
  });

  it('inclui os filtros na chave de cache', () => {
    expect(jobsListQueryKey({ page: 1 })).not.toEqual(jobsListQueryKey({ page: 2 }));
  });

  it('mantem a tabela anterior ao paginar', () => {
    expect(JOBS_STALE_TIME_MS).toBe(60_000);
  });

  it('devolve a lista validada', async () => {
    stubFetch(() => ({
      ...JOBS_PAYLOAD,
      total: 1,
      totalPages: 1,
      items: [
        {
          id: 'job-1',
          fingerprint: 'a'.repeat(64),
          title: 'Dev React',
          company: 'Acme Corp',
          recruiterName: null,
          source: 'gupy',
          city: 'Salvador/BA',
          isRemote: true,
          scope: 'NATIONAL',
          workModel: 'REMOTE',
          url: 'https://gupy.io/vagas/1',
          tags: ['React'],
          publishedAt: '2026-10-26T10:00:00.000Z',
          description: 'Descricao da vaga para o painel de detalhe.',
          publishedAtSource: 'SOURCE',
        },
      ],
    }));

    const { result } = renderHook(() => useJobsList(), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items[0]?.title).toBe('Dev React');
  });
});

const SOURCE_HEALTH_PAYLOAD = {
  windowInHours: 24,
  sources: [
    {
      source: 'linkedin-posts',
      status: 'OK',
      lastRunAt: '2026-10-26T12:00:00.000Z',
      nextRunAt: '2026-10-26T16:00:00.000Z',
      intervalInHours: 4,
      runs: 6,
      failures: 0,
      totalFound: 5,
    },
  ],
};

describe('useSourceHealth', () => {
  it('consome /api/dashboard/sources-health', async () => {
    const spy = stubFetch(() => SOURCE_HEALTH_PAYLOAD);

    const { result } = renderHook(() => useSourceHealth(), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(spy.mock.calls[0]?.[0]).toBe('/api/dashboard/sources-health');
    expect(result.current.data?.sources[0]?.intervalInHours).toBe(4);
  });

  it('tem chave propria no cache', () => {
    expect(sourceHealthQueryKey()).toEqual(['dashboard', 'sources-health']);
  });

  it('rejeita resposta fora do contrato', async () => {
    stubFetch(() => ({ windowInHours: 24, sources: [{ source: 'gupy' }] }));

    const { result } = renderHook(() => useSourceHealth(), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
