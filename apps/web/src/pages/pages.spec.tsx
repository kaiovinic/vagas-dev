import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { App } from '@/app';
import { DashboardPage } from '@/pages/dashboard-page';
import { JobsPage } from '@/pages/jobs-page';
import { jsonResponse, renderWithProviders } from '../../test/render';

const SUMMARY = {
  windowInHours: 72,
  capture: {
    lastCaptureAt: '2026-10-26T11:53:00.000Z',
    nextCaptureAt: '2026-10-26T13:53:00.000Z',
    status: 'SUCCESS',
    failedSources: [],
  },
  openJobs: { total: 40 },
  newInLast24h: { total: 12, previousTotal: 9, delta: 3 },
  remote: { total: 30, percentage: 75 },
  hiringCompanies: { total: 17 },
};

function charts(days: number): unknown {
  return {
    days,
    windowInHours: 72,
    sources: ['gupy', 'linkedin'],
    openJobsBySource: [
      { source: 'linkedin', total: 6, percentage: 60 },
      { source: 'gupy', total: 4, percentage: 40 },
    ],
    newJobsByDay: [
      {
        day: '2026-10-25',
        total: 4,
        sources: [{ source: 'gupy', total: 4, percentage: 100 }],
      },
    ],
  };
}

const JOB = {
  id: 'job-1',
  fingerprint: 'a'.repeat(64),
  title: 'Desenvolvedor Frontend React',
  company: 'Acme Corp',
  recruiterName: null,
  source: 'gupy',
  city: 'Salvador/BA',
  isRemote: true,
  scope: 'NATIONAL',
  workModel: 'REMOTE',
  url: 'https://gupy.io/vagas/1',
  tags: ['React', 'TypeScript'],
  publishedAt: '2026-10-26T11:00:00.000Z',
  publishedAtSource: 'SOURCE',
};

function stubApi(): ReturnType<typeof vi.fn> {
  const spy = vi.fn((url: string) => {
    if (url.startsWith('/api/dashboard/summary')) {
      return Promise.resolve(jsonResponse(SUMMARY));
    }

    if (url.startsWith('/api/market')) {
      return Promise.resolve(jsonResponse({ windowInHours: 72, openJobs: 1, technologies: [], seniorities: [], workModels: [], scopes: [], seniorityNotInformed: { id: 'UNKNOWN', label: 'Nao informado', total: 1, percentage: 100 } }));
    }

    if (url.startsWith('/api/jobs/')) {
      return Promise.resolve(jsonResponse([]));
    }

    if (url.startsWith('/api/dashboard/charts')) {
      const days = Number(new URLSearchParams(url.split('?')[1] ?? '').get('days') ?? 14);

      return Promise.resolve(jsonResponse(charts(days)));
    }

    return Promise.resolve(
      jsonResponse({ items: [JOB], total: 1, page: 1, perPage: 20, totalPages: 1 }),
    );
  });

  vi.stubGlobal('fetch', spy);

  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DashboardPage', () => {
  it('mostra os KPIs e os dois graficos com dados da api', async () => {
    stubApi();

    renderWithProviders(<DashboardPage />);

    await waitFor(() => expect(screen.getByText('40')).toBeInTheDocument());

    expect(screen.getByTestId('kpi-delta')).toHaveTextContent('+3 vs. 24h anteriores');
    expect(screen.getByText('75% das vagas abertas')).toBeInTheDocument();
    expect(screen.getByTestId('donut-legend')).toHaveTextContent('LinkedIn');
    expect(screen.getByTestId('stacked-bar-chart')).toBeInTheDocument();
  });

  it('recarrega o grafico ao trocar o periodo, sem derrubar a tela', async () => {
    const spy = stubApi();

    renderWithProviders(<DashboardPage />);

    await waitFor(() => expect(screen.getByTestId('stacked-bar-chart')).toBeInTheDocument());

    await userEvent.selectOptions(screen.getByLabelText('Periodo do grafico'), '30');

    await waitFor(() =>
      expect(
        spy.mock.calls.some((call) => String(call[0]).includes('days=30')),
      ).toBe(true),
    );

    // O grafico anterior nunca sai da tela durante a troca.
    expect(screen.getByTestId('stacked-bar-chart')).toBeInTheDocument();
    expect(screen.getByLabelText('Periodo do grafico')).toHaveValue('30');
  });

  it('mostra o erro quando o grafico falha', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url.startsWith('/api/dashboard/charts')
          ? Promise.resolve(jsonResponse({ message: 'Parametros invalidos' }, 400))
          : Promise.resolve(jsonResponse(SUMMARY)),
      ),
    );

    renderWithProviders(<DashboardPage />);

    await waitFor(() =>
      expect(screen.getAllByText('Nao foi possivel carregar o grafico')).toHaveLength(2),
    );
  });
});

describe('JobsPage', () => {
  it('lista as vagas abertas da api', async () => {
    stubApi();

    renderWithProviders(<JobsPage />);

    await waitFor(() =>
      expect(screen.getByText('Desenvolvedor Frontend React')).toBeInTheDocument(),
    );

    const link = screen.getByRole('link', { name: /Desenvolvedor Frontend React/ });
    const row = link.closest('li');

    expect(link).toHaveAttribute('href', 'https://gupy.io/vagas/1');
    // Escopo na linha da vaga: "React" e "Remoto" tambem aparecem no filtro acima.
    expect(row).toHaveTextContent('Acme Corp');
    expect(row).toHaveTextContent('Salvador/BA');
    expect(row).toHaveTextContent('Remoto');
    expect(row).toHaveTextContent('React');
  });

  it('busca pelo termo submetido no filtro', async () => {
    const spy = stubApi();

    renderWithProviders(<JobsPage />);

    await waitFor(() =>
      expect(screen.getByText('Desenvolvedor Frontend React')).toBeInTheDocument(),
    );

    await userEvent.type(screen.getByLabelText('Busca'), 'angular');
    await userEvent.click(screen.getByRole('button', { name: 'Filtrar' }));

    await waitFor(() =>
      expect(spy.mock.calls.some((call) => String(call[0]).includes('search=angular'))).toBe(
        true,
      ),
    );
  });

  it('manda as tecnologias marcadas como tech na query string', async () => {
    const spy = stubApi();

    renderWithProviders(<JobsPage />);

    await waitFor(() =>
      expect(screen.getByText('Desenvolvedor Frontend React')).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole('checkbox', { name: 'React' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Node.js' }));

    await waitFor(() =>
      expect(
        spy.mock.calls.some((call) => String(call[0]).includes('tech=React%2CNode.js')),
      ).toBe(true),
    );
  });

  it('manda a senioridade marcada na query string', async () => {
    const spy = stubApi();

    renderWithProviders(<JobsPage />);

    await waitFor(() =>
      expect(screen.getByText('Desenvolvedor Frontend React')).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole('checkbox', { name: 'Pleno' }));

    await waitFor(() =>
      expect(spy.mock.calls.some((call) => String(call[0]).includes('seniority=MID'))).toBe(
        true,
      ),
    );
  });

  it('traduz a modalidade em isRemote na query string', async () => {
    const spy = stubApi();

    renderWithProviders(<JobsPage />);

    await waitFor(() =>
      expect(screen.getByText('Desenvolvedor Frontend React')).toBeInTheDocument(),
    );

    await userEvent.click(
      screen.getByRole('radio', { name: 'Apenas Salvador/Presencial/Hibrido' }),
    );

    await waitFor(() =>
      expect(spy.mock.calls.some((call) => String(call[0]).includes('isRemote=false'))).toBe(
        true,
      ),
    );
  });

  it('filtra por fonte', async () => {
    const spy = stubApi();

    renderWithProviders(<JobsPage />);

    await waitFor(() =>
      expect(screen.getByText('Desenvolvedor Frontend React')).toBeInTheDocument(),
    );

    await userEvent.selectOptions(screen.getByLabelText('Fonte'), 'gupy');

    await waitFor(() =>
      expect(spy.mock.calls.some((call) => String(call[0]).includes('source=gupy'))).toBe(true),
    );
  });

  it('volta para a primeira pagina ao aplicar um filtro novo', async () => {
    const spy = stubApi();

    renderWithProviders(<JobsPage />);

    await waitFor(() =>
      expect(screen.getByText('Desenvolvedor Frontend React')).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole('checkbox', { name: 'React' }));

    await waitFor(() => {
      const lastCall = String(spy.mock.calls.at(-1)?.[0]);

      expect(lastCall).toContain('page=1');
    });
  });

  it('avisa quando nenhuma vaga foi encontrada', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(jsonResponse({ items: [], total: 0, page: 1, perPage: 20, totalPages: 0 })),
      ),
    );

    renderWithProviders(<JobsPage />);

    await waitFor(() => expect(screen.getByText('Nenhuma vaga encontrada')).toBeInTheDocument());
  });

  it('mostra o erro da api', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse({ message: 'quebrou' }, 500))),
    );

    renderWithProviders(<JobsPage />);

    await waitFor(() =>
      expect(screen.getByText('Nao foi possivel carregar as vagas')).toBeInTheDocument(),
    );
  });

  it('filtra pela empresa que veio na url da aba Empresas', async () => {
    const spy = stubApi();

    renderWithProviders(<JobsPage />, { route: '/vagas?company=Acme%20Corp' });

    await waitFor(() =>
      expect(spy.mock.calls.some((call) => String(call[0]).includes('company=Acme+Corp'))).toBe(
        true,
      ),
    );
    expect(screen.getByTestId('drilldown-chips')).toHaveTextContent('Empresa: Acme Corp');
  });

  it('filtra pelo recrutador que veio na url da aba Recrutadores', async () => {
    const spy = stubApi();

    renderWithProviders(<JobsPage />, { route: '/vagas?recruiterName=octocat' });

    await waitFor(() =>
      expect(
        spy.mock.calls.some((call) => String(call[0]).includes('recruiterName=octocat')),
      ).toBe(true),
    );
    expect(screen.getByTestId('drilldown-chips')).toHaveTextContent('Recrutador: octocat');
  });

  it('remove o filtro de empresa pelo chip', async () => {
    stubApi();

    renderWithProviders(<JobsPage />, { route: '/vagas?company=Acme%20Corp' });

    await waitFor(() => expect(screen.getByTestId('drilldown-chips')).toBeInTheDocument());

    await userEvent.click(
      screen.getByRole('button', { name: 'Remover filtro Empresa: Acme Corp' }),
    );

    await waitFor(() =>
      expect(screen.queryByTestId('drilldown-chips')).not.toBeInTheDocument(),
    );
  });

  it('ja chega com a stack marcada quando vem da aba Mercado', async () => {
    const spy = stubApi();

    renderWithProviders(<JobsPage />, { route: '/vagas?tech=React' });

    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'React' })).toBeChecked(),
    );
    expect(spy.mock.calls.some((call) => String(call[0]).includes('tech=React'))).toBe(true);
  });

  it('ja chega com a senioridade marcada quando vem da aba Mercado', async () => {
    const spy = stubApi();

    renderWithProviders(<JobsPage />, { route: '/vagas?seniority=SENIOR' });

    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'Senior' })).toBeChecked(),
    );
    expect(spy.mock.calls.some((call) => String(call[0]).includes('seniority=SENIOR'))).toBe(
      true,
    );
  });

  it('ignora um scope herdado na url, que nao existe mais como filtro', async () => {
    const spy = stubApi();

    renderWithProviders(<JobsPage />, { route: '/vagas?scope=INTERNATIONAL' });

    await waitFor(() =>
      expect(screen.getByText('Desenvolvedor Frontend React')).toBeInTheDocument(),
    );
    expect(spy.mock.calls.some((call) => String(call[0]).includes('scope='))).toBe(false);
  });

  it('ignora valores desconhecidos vindos da url', async () => {
    stubApi();

    renderWithProviders(<JobsPage />, { route: '/vagas?tech=Cobol&seniority=ARQUITETO' });

    await waitFor(() =>
      expect(screen.getByText('Desenvolvedor Frontend React')).toBeInTheDocument(),
    );
    expect(screen.getByRole('checkbox', { name: 'React' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Senior' })).not.toBeChecked();
  });

  it('nao mostra chip quando nao ha drill-down', async () => {
    stubApi();

    renderWithProviders(<JobsPage />);

    await waitFor(() =>
      expect(screen.getByText('Desenvolvedor Frontend React')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('drilldown-chips')).not.toBeInTheDocument();
  });

  it('desabilita a paginacao quando ha uma unica pagina', async () => {
    stubApi();

    renderWithProviders(<JobsPage />);

    await waitFor(() => expect(screen.getByText(/1 vaga\(s\)/)).toBeInTheDocument());

    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Proxima' })).toBeDisabled();
  });
});

describe('App', () => {
  it('abre no dashboard', async () => {
    stubApi();

    renderWithProviders(<App />, { route: '/' });

    await waitFor(() => expect(screen.getByText('Vagas abertas')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('navega entre as abas pelas pilulas', async () => {
    stubApi();

    renderWithProviders(<App />, { route: '/dashboard' });

    await userEvent.click(screen.getByRole('link', { name: 'Vagas' }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Vagas abertas' })).toBeInTheDocument(),
    );
  });

  it('abre a aba Regras com os criterios publicos', async () => {
    stubApi();

    renderWithProviders(<App />, { route: '/regras' });

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Regras do filtro' })).toBeInTheDocument(),
    );
    expect(screen.getByRole('form', { name: 'Testador de publicacao' })).toBeInTheDocument();
  });

  it.each([
    ['Empresas contratando', '/empresas'],
    ['Recrutadores', '/recrutadores'],
    ['Stacks mais pedidas', '/mercado'],
  ])('abre a aba %s', async (heading, route) => {
    stubApi();

    renderWithProviders(<App />, { route });

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument(),
    );
  });

  it('nao tem mais nenhuma aba em construcao', async () => {
    stubApi();

    for (const route of ['/vagas', '/dashboard', '/empresas', '/recrutadores', '/mercado', '/regras']) {
      const { unmount } = renderWithProviders(<App />, { route });

      expect(screen.queryByText('Aba em construcao')).not.toBeInTheDocument();
      unmount();
    }
  });

  it('redireciona rota desconhecida para o dashboard', async () => {
    stubApi();

    renderWithProviders(<App />, { route: '/nao-existe' });

    await waitFor(() => expect(screen.getByText('Vagas abertas')).toBeInTheDocument());
  });
});
