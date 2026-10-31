import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RulesPage } from '@/pages/rules-page';
import { jsonResponse, renderWithProviders } from '../../test/render';

const RULES = {
  version: '1.0.0',
  publicationWindowInHours: 72,
  rules: [
    {
      id: 'publication-window',
      name: 'Janela de publicacao de 72 horas',
      description: 'Somente vagas publicadas nas ultimas 72 horas.',
      kind: 'TIME_WINDOW',
      criteria: ['Publicada nos ultimos 72h'],
      rejectionReason: 'EXPIRED_PUBLICATION',
    },
    {
      id: 'stack-match',
      name: 'Stack Frontend ou Fullstack',
      description: 'A vaga precisa citar a stack monitorada.',
      kind: 'KEYWORD_ALLOW_LIST',
      criteria: ['React', 'Next.js', 'TypeScript'],
      rejectionReason: 'STACK_NOT_MATCHED',
    },
    {
      id: 'location-match',
      name: 'Remoto ou qualquer municipio da Bahia',
      description: 'Aceitamos remotas ou de qualquer municipio da Bahia.',
      kind: 'LOCATION_ALLOW_LIST',
      criteria: ['Remoto', 'Bahia/BA', 'Salvador/BA'],
      rejectionReason: 'LOCATION_NOT_ALLOWED',
    },
    {
      id: 'spam-filter',
      name: 'Higienizacao de publicacoes que nao sao vagas',
      description: 'Descartamos cursos, bootcamps e divulgacao de curriculo.',
      kind: 'KEYWORD_DENY_LIST',
      criteria: ['Curso', 'Bootcamp', '#opentowork'],
      rejectionReason: 'SPAM_DETECTED',
    },
  ],
};

function stubApi(rules: unknown = RULES, status = 200): ReturnType<typeof vi.fn> {
  const spy = vi.fn((url: string) =>
    Promise.resolve(
      url.startsWith('/api/rules/test')
        ? jsonResponse({
            approved: true,
            rejectionReasons: [],
            matchedStack: ['React'],
            matchedLocations: ['Remoto'],
            matchedSpamTerms: [],
            evaluated: {
              title: 'Dev React',
              company: 'Empresa nao informada',
              location: '',
              workModel: 'UNKNOWN',
              publishedAt: '2026-10-26T12:00:00.000Z',
              url: 'https://devradar.local/teste-de-regras',
            },
          })
        : jsonResponse(rules, status),
    ),
  );

  vi.stubGlobal('fetch', spy);

  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RulesPage', () => {
  it('consome /api/rules', async () => {
    const spy = stubApi();

    renderWithProviders(<RulesPage />);

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0]?.[0]).toBe('/api/rules');
  });

  it('mostra a versao das regras no subtitulo', async () => {
    stubApi();

    renderWithProviders(<RulesPage />);

    await waitFor(() => expect(screen.getByText(/versao 1\.0\.0/)).toBeInTheDocument());
  });

  it('lista as quatro regras publicas, numeradas', async () => {
    stubApi();

    renderWithProviders(<RulesPage />);

    await waitFor(() =>
      expect(screen.getByTestId('rule-publication-window')).toBeInTheDocument(),
    );

    expect(screen.getByTestId('rule-stack-match')).toHaveTextContent(
      '2. Stack Frontend ou Fullstack',
    );
    expect(screen.getByTestId('rule-location-match')).toBeInTheDocument();
    expect(screen.getByTestId('rule-spam-filter')).toBeInTheDocument();
  });

  it('mostra os criterios de stack aceitos', async () => {
    stubApi();

    renderWithProviders(<RulesPage />);

    const rule = await screen.findByTestId('rule-stack-match');

    expect(rule).toHaveTextContent('React');
    expect(rule).toHaveTextContent('Next.js');
    expect(rule).toHaveTextContent('TypeScript');
    expect(rule).toHaveTextContent('Termos aceitos');
  });

  it('mostra as localidades aceitas', async () => {
    stubApi();

    renderWithProviders(<RulesPage />);

    const rule = await screen.findByTestId('rule-location-match');

    expect(rule).toHaveTextContent('Remoto');
    expect(rule).toHaveTextContent('Salvador/BA');
    expect(rule).toHaveTextContent('Localidades aceitas');
  });

  it('mostra as palavras bloqueadas do anti-spam', async () => {
    stubApi();

    renderWithProviders(<RulesPage />);

    const rule = await screen.findByTestId('rule-spam-filter');

    expect(rule).toHaveTextContent('Bootcamp');
    expect(rule).toHaveTextContent('#opentowork');
    expect(rule).toHaveTextContent('Termos bloqueados');
  });

  it('informa o motivo de rejeicao de cada regra', async () => {
    stubApi();

    renderWithProviders(<RulesPage />);

    await waitFor(() =>
      expect(screen.getByTestId('rule-spam-filter')).toHaveTextContent('SPAM_DETECTED'),
    );
  });

  it('exibe skeleton enquanto as regras carregam', () => {
    stubApi();

    renderWithProviders(<RulesPage />);

    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
  });

  it('mostra o erro quando as regras falham', async () => {
    stubApi({ message: 'indisponivel' }, 503);

    renderWithProviders(<RulesPage />);

    await waitFor(() =>
      expect(screen.getByText('Nao foi possivel carregar as regras')).toBeInTheDocument(),
    );
  });

  it('traz o testador de publicacao na mesma aba', async () => {
    stubApi();

    renderWithProviders(<RulesPage />);

    expect(screen.getByRole('form', { name: 'Testador de publicacao' })).toBeInTheDocument();

    await userEvent.type(
      screen.getByLabelText('Texto da publicacao'),
      'Vaga para Dev React 100% remota',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Validar Regra' }));

    expect(await screen.findByTestId('tester-result')).toHaveTextContent('Passaria no filtro');
  });
});
