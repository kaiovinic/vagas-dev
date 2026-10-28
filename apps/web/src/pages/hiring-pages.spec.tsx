import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CompaniesPage } from '@/pages/companies-page';
import { RecruitersPage } from '@/pages/recruiters-page';
import { jsonResponse, renderWithProviders } from '../../test/render';

const COMPANIES = [
  {
    name: 'Fcamara',
    total: 5,
    remoteTotal: 4,
    lastPublishedAt: '2026-10-26T19:00:00.000Z',
  },
  {
    name: 'Acme Corp',
    total: 2,
    remoteTotal: 0,
    lastPublishedAt: '2026-10-26T21:00:00.000Z',
  },
  {
    name: 'Globex',
    total: 2,
    remoteTotal: 2,
    lastPublishedAt: '2026-10-25T10:00:00.000Z',
  },
];

const RECRUITERS = [
  { name: 'octocat', total: 3, remoteTotal: 3, lastPublishedAt: '2026-10-26T18:00:00.000Z' },
];

function stubApi(body: unknown = COMPANIES, status = 200): ReturnType<typeof vi.fn> {
  const spy = vi.fn(() => Promise.resolve(jsonResponse(body, status)));

  vi.stubGlobal('fetch', spy);

  return spy;
}

function rowNames(): string[] {
  const body = screen.getAllByRole('rowgroup')[1];

  return within(body as HTMLElement)
    .getAllByRole('row')
    .map((row) => within(row).getAllByRole('cell').length > 0 ? row.textContent ?? '' : '')
    .map((text) => text.trim());
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CompaniesPage', () => {
  it('consome /api/jobs/companies', async () => {
    const spy = stubApi();

    renderWithProviders(<CompaniesPage />);

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0]?.[0]).toBe('/api/jobs/companies');
  });

  it('lista as empresas com vagas, remotas e ultima publicacao', async () => {
    stubApi();

    renderWithProviders(<CompaniesPage />);

    await waitFor(() => expect(screen.getByText('Fcamara')).toBeInTheDocument());

    expect(screen.getByRole('columnheader', { name: 'Empresa' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Vagas' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Remotas' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Ultima vaga' })).toBeInTheDocument();
  });

  it('ordena por mais vagas por padrao', async () => {
    stubApi();

    renderWithProviders(<CompaniesPage />);

    await waitFor(() => expect(screen.getByText('Fcamara')).toBeInTheDocument());
    expect(rowNames()[0]).toContain('Fcamara');
  });

  it('mostra o percentual de remotas da empresa', async () => {
    stubApi();

    renderWithProviders(<CompaniesPage />);

    await waitFor(() => expect(screen.getByText('Fcamara')).toBeInTheDocument());
    expect(rowNames()[0]).toContain('80%');
  });

  it('ordena por quem publicou por ultimo', async () => {
    stubApi();

    renderWithProviders(<CompaniesPage />);

    await waitFor(() => expect(screen.getByText('Fcamara')).toBeInTheDocument());

    await userEvent.selectOptions(screen.getByLabelText('Ordenar por'), 'recent');

    expect(rowNames()[0]).toContain('Acme Corp');
  });

  it('ordena por nome', async () => {
    stubApi();

    renderWithProviders(<CompaniesPage />);

    await waitFor(() => expect(screen.getByText('Fcamara')).toBeInTheDocument());

    await userEvent.selectOptions(screen.getByLabelText('Ordenar por'), 'name');

    expect(rowNames()[0]).toContain('Acme Corp');
    expect(rowNames()[2]).toContain('Globex');
  });

  it('busca empresa pelo nome', async () => {
    stubApi();

    renderWithProviders(<CompaniesPage />);

    await waitFor(() => expect(screen.getByText('Fcamara')).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText('Buscar empresa'), 'glob');

    expect(screen.getByText('Globex')).toBeInTheDocument();
    expect(screen.queryByText('Fcamara')).not.toBeInTheDocument();
  });

  it('avisa quando a busca nao encontra nada', async () => {
    stubApi();

    renderWithProviders(<CompaniesPage />);

    await waitFor(() => expect(screen.getByText('Fcamara')).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText('Buscar empresa'), 'zzz');

    expect(screen.getByText('Nada encontrado para essa busca')).toBeInTheDocument();
  });

  it('resume o total de empresas e vagas', async () => {
    stubApi();

    renderWithProviders(<CompaniesPage />);

    await waitFor(() => expect(screen.getByTestId('hiring-summary')).toBeInTheDocument());
    expect(screen.getByTestId('hiring-summary')).toHaveTextContent('3 empresa(s)');
    expect(screen.getByTestId('hiring-summary')).toHaveTextContent('9 vaga(s)');
  });

  it('leva para a aba Vagas filtrada pela empresa', async () => {
    stubApi();

    renderWithProviders(<CompaniesPage />);

    await waitFor(() => expect(screen.getByText('Fcamara')).toBeInTheDocument());

    expect(screen.getByRole('link', { name: 'Fcamara' })).toHaveAttribute(
      'href',
      '/vagas?company=Fcamara',
    );
  });

  it('codifica nomes com espaco no link', async () => {
    stubApi();

    renderWithProviders(<CompaniesPage />);

    await waitFor(() => expect(screen.getByText('Acme Corp')).toBeInTheDocument());

    expect(screen.getByRole('link', { name: 'Acme Corp' })).toHaveAttribute(
      'href',
      '/vagas?company=Acme%20Corp',
    );
  });

  it('exibe skeleton enquanto carrega', () => {
    stubApi();

    renderWithProviders(<CompaniesPage />);

    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
  });

  it('avisa quando nenhuma empresa esta contratando', async () => {
    stubApi([]);

    renderWithProviders(<CompaniesPage />);

    await waitFor(() =>
      expect(
        screen.getByText('Nenhuma empresa contratando nas ultimas 72h'),
      ).toBeInTheDocument(),
    );
  });

  it('mostra o erro da api', async () => {
    stubApi({ message: 'indisponivel' }, 503);

    renderWithProviders(<CompaniesPage />);

    await waitFor(() =>
      expect(screen.getByText(/Nao foi possivel carregar/)).toBeInTheDocument(),
    );
  });
});

describe('RecruitersPage', () => {
  it('consome /api/jobs/recruiters', async () => {
    const spy = stubApi(RECRUITERS);

    renderWithProviders(<RecruitersPage />);

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0]?.[0]).toBe('/api/jobs/recruiters');
  });

  it('usa o rotulo de recrutador na tabela', async () => {
    stubApi(RECRUITERS);

    renderWithProviders(<RecruitersPage />);

    await waitFor(() => expect(screen.getByText('octocat')).toBeInTheDocument());
    expect(screen.getByRole('columnheader', { name: 'Recrutador' })).toBeInTheDocument();
    expect(screen.getByLabelText('Buscar recrutador')).toBeInTheDocument();
  });

  it('leva para a aba Vagas filtrada pelo recrutador', async () => {
    stubApi(RECRUITERS);

    renderWithProviders(<RecruitersPage />);

    await waitFor(() => expect(screen.getByText('octocat')).toBeInTheDocument());

    expect(screen.getByRole('link', { name: 'octocat' })).toHaveAttribute(
      'href',
      '/vagas?recruiterName=octocat',
    );
  });

  it('explica a lista vazia, ja que nem toda fonte informa quem publicou', async () => {
    stubApi([]);

    renderWithProviders(<RecruitersPage />);

    await waitFor(() =>
      expect(
        screen.getByText('Nenhuma vaga com recrutador identificado nas ultimas 72h'),
      ).toBeInTheDocument(),
    );
  });
});
