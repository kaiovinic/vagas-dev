import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import type { DashboardSummary } from '@/api/schemas';
import { AppHeader } from '@/components/layout/app-header';
import { CaptureStatus } from '@/components/layout/capture-status';
import { NAVIGATION_TABS } from '@/components/layout/navigation';
import { renderWithProviders } from '../../../test/render';

const NOW = new Date('2026-10-26T12:00:00.000Z');

function capture(
  overrides: Partial<DashboardSummary['capture']> = {},
): DashboardSummary['capture'] {
  return {
    lastCaptureAt: '2026-10-26T11:53:00.000Z',
    nextCaptureAt: '2026-10-26T13:53:00.000Z',
    status: 'SUCCESS',
    failedSources: [],
    ...overrides,
  };
}

describe('CaptureStatus', () => {
  it('exibe o fuso de Brasilia', () => {
    renderWithProviders(<CaptureStatus capture={capture()} now={NOW} />);

    expect(screen.getByText(/Horario de Brasilia \(UTC-3\)/)).toBeInTheDocument();
  });

  it('conta o tempo desde a ultima captura e mostra a hora de Brasilia', () => {
    renderWithProviders(<CaptureStatus capture={capture()} now={NOW} />);

    const last = screen.getByTestId('last-capture');

    expect(last).toHaveTextContent('ha 7 min');
    // 11:53Z = 08:53 em Brasilia.
    expect(last).toHaveTextContent('08:53');
  });

  it('conta o tempo restante ate a proxima captura', () => {
    renderWithProviders(<CaptureStatus capture={capture()} now={NOW} />);

    const next = screen.getByTestId('next-capture');

    expect(next).toHaveTextContent('em 113 min');
    expect(next).toHaveTextContent('10:53');
  });

  it('avisa quando ainda nao houve captura', () => {
    renderWithProviders(
      <CaptureStatus capture={capture({ lastCaptureAt: null, nextCaptureAt: null })} now={NOW} />,
    );

    expect(screen.getByTestId('last-capture')).toHaveTextContent('sem registro');
    expect(screen.getByTestId('next-capture')).toHaveTextContent('nao agendada');
  });

  it('trata o resumo ainda nao carregado', () => {
    renderWithProviders(<CaptureStatus capture={undefined} now={NOW} />);

    expect(screen.getByTestId('last-capture')).toHaveTextContent('sem registro');
  });

  it.each([
    ['uma fonte', ['linkedin'], '1 fonte falhou: linkedin'],
    ['varias fontes', ['linkedin', 'gupy'], '2 fontes falharam: linkedin, gupy'],
  ])('destaca a falha de %s na ultima captura', (_label, failedSources, expected) => {
    renderWithProviders(<CaptureStatus capture={capture({ failedSources })} now={NOW} />);

    expect(screen.getByTestId('failed-sources')).toHaveTextContent(expected);
  });

  it('nao mostra aviso quando todas as fontes responderam', () => {
    renderWithProviders(<CaptureStatus capture={capture()} now={NOW} />);

    expect(screen.queryByTestId('failed-sources')).not.toBeInTheDocument();
  });
});

describe('AppHeader', () => {
  it('exibe a logo do painel', () => {
    renderWithProviders(<AppHeader capture={capture()} />);

    // O logo e uma imagem: o nome acessivel vem do `alt`, nao do texto.
    expect(screen.getByRole('heading', { level: 1, name: 'Vagas Dev BA/Remoto' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Vagas Dev BA/Remoto' })).toBeInTheDocument();
  });

  it('mostra as seis abas em pilulas, na ordem do painel', () => {
    renderWithProviders(<AppHeader capture={capture()} />);

    const links = screen.getAllByRole('link');

    expect(links.map((link) => link.textContent)).toEqual([
      'Vagas',
      'Dashboard',
      'Empresas',
      'Recrutadores',
      'Mercado',
      'Regras',
    ]);
  });

  it('aponta cada pilula para a sua rota', () => {
    renderWithProviders(<AppHeader capture={capture()} />);

    for (const tab of NAVIGATION_TABS) {
      expect(screen.getByRole('link', { name: tab.label })).toHaveAttribute('href', tab.path);
    }
  });

  it('marca a aba atual como ativa', () => {
    renderWithProviders(<AppHeader capture={capture()} />, { route: '/dashboard' });

    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Vagas' })).not.toHaveAttribute('aria-current');
  });

  it('inclui o subtitulo com os contadores de captura', () => {
    renderWithProviders(<AppHeader capture={capture()} />);

    expect(screen.getByTestId('last-capture')).toBeInTheDocument();
    expect(screen.getByTestId('next-capture')).toBeInTheDocument();
  });
});
