import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { MarketPage } from '@/pages/market-page';
import { jsonResponse, renderWithProviders } from '../../test/render';

const INSIGHTS = {
  windowInHours: 72,
  openJobs: 50,
  technologies: [
    { id: 'React', label: 'React', total: 30, percentage: 60 },
    { id: 'Node.js', label: 'Node.js', total: 15, percentage: 30 },
  ],
  seniorities: [
    { id: 'SENIOR', label: 'Senior', total: 27, percentage: 54 },
    { id: 'MID', label: 'Pleno', total: 4, percentage: 8 },
  ],
  workModels: [
    { id: 'REMOTE', label: 'Remoto', total: 47, percentage: 94 },
    { id: 'ONSITE', label: 'Presencial', total: 3, percentage: 6 },
  ],
  scopes: [
    { id: 'NATIONAL', label: 'Nacionais', total: 27, percentage: 54 },
    { id: 'INTERNATIONAL', label: 'Internacionais', total: 19, percentage: 38 },
    { id: 'UNKNOWN', label: 'Nao identificado', total: 4, percentage: 8 },
  ],
  seniorityNotInformed: { id: 'UNKNOWN', label: 'Nao informado', total: 19, percentage: 38 },
};

function stubApi(body: unknown = INSIGHTS, status = 200): ReturnType<typeof vi.fn> {
  const spy = vi.fn(() => Promise.resolve(jsonResponse(body, status)));

  vi.stubGlobal('fetch', spy);

  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MarketPage', () => {
  it('consome /api/market', async () => {
    const spy = stubApi();

    renderWithProviders(<MarketPage />);

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0]?.[0]).toBe('/api/market');
  });

  it('mostra a divisao por mercado', async () => {
    stubApi();

    renderWithProviders(<MarketPage />);

    const nacional = await screen.findByTestId('slice-scope-NATIONAL');

    expect(screen.getByRole('heading', { name: 'Mercado' })).toBeInTheDocument();
    expect(nacional).toHaveTextContent('Nacionais');
    expect(nacional).toHaveTextContent('27');
    expect(nacional).toHaveTextContent('54%');
  });

  it('nao linka o mercado para a aba Vagas, que nao filtra mais por ele', async () => {
    stubApi();

    renderWithProviders(<MarketPage />);

    await waitFor(() => expect(screen.getByTestId('slice-scope-NATIONAL')).toBeInTheDocument());

    expect(screen.queryByRole('link', { name: 'Nacionais' })).not.toBeInTheDocument();
  });

  it('mostra os tres blocos de tendencia', async () => {
    stubApi();

    renderWithProviders(<MarketPage />);

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Stacks mais pedidas' })).toBeInTheDocument(),
    );
    expect(screen.getByRole('heading', { name: 'Senioridade' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Modalidade' })).toBeInTheDocument();
  });

  it('mostra quantidade e percentual de cada stack', async () => {
    stubApi();

    renderWithProviders(<MarketPage />);

    const react = await screen.findByTestId('slice-tech-React');

    expect(react).toHaveTextContent('React');
    expect(react).toHaveTextContent('30');
    expect(react).toHaveTextContent('60%');
  });

  it('avisa que o percentual e sobre as vagas abertas', async () => {
    stubApi();

    renderWithProviders(<MarketPage />);

    await waitFor(() =>
      expect(screen.getByText(/Sobre as 50 vagas abertas das ultimas 72h/)).toBeInTheDocument(),
    );
  });

  it('inclui as vagas sem nivel declarado na senioridade', async () => {
    stubApi();

    renderWithProviders(<MarketPage />);

    const naoInformado = await screen.findByTestId('slice-seniority-UNKNOWN');

    expect(naoInformado).toHaveTextContent('Nao informado');
    expect(naoInformado).toHaveTextContent('19');
  });

  it('leva para a aba Vagas filtrada pela stack', async () => {
    stubApi();

    renderWithProviders(<MarketPage />);

    await waitFor(() => expect(screen.getByTestId('slice-tech-React')).toBeInTheDocument());

    expect(screen.getByRole('link', { name: 'React' })).toHaveAttribute(
      'href',
      '/vagas?tech=React',
    );
  });

  it('leva para a aba Vagas filtrada pela senioridade', async () => {
    stubApi();

    renderWithProviders(<MarketPage />);

    await waitFor(() => expect(screen.getByTestId('slice-seniority-SENIOR')).toBeInTheDocument());

    expect(screen.getByRole('link', { name: 'Senior' })).toHaveAttribute(
      'href',
      '/vagas?seniority=SENIOR',
    );
  });

  it('nao linka o grupo sem nivel declarado nem a modalidade', async () => {
    stubApi();

    renderWithProviders(<MarketPage />);

    await waitFor(() => expect(screen.getByTestId('slice-seniority-UNKNOWN')).toBeInTheDocument());

    expect(screen.queryByRole('link', { name: 'Nao informado' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Remoto' })).not.toBeInTheDocument();
  });

  it('exibe skeleton enquanto carrega', () => {
    stubApi();

    renderWithProviders(<MarketPage />);

    expect(screen.getByTestId('skeleton')).toBeInTheDocument();
  });

  it('avisa quando nao ha vagas para analisar', async () => {
    stubApi({ ...INSIGHTS, openJobs: 0, technologies: [], seniorities: [], workModels: [], scopes: [] });

    renderWithProviders(<MarketPage />);

    await waitFor(() =>
      expect(screen.getByText('Sem vagas abertas para analisar')).toBeInTheDocument(),
    );
  });

  it('mostra o erro da api', async () => {
    stubApi({ message: 'indisponivel' }, 503);

    renderWithProviders(<MarketPage />);

    await waitFor(() =>
      expect(screen.getByText('Nao foi possivel carregar o mercado')).toBeInTheDocument(),
    );
  });
});
