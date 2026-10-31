import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { SourceHealthRow } from '@/api/schemas';
import { SourceHealthTable } from '@/components/health/source-health-table';

const NOW = new Date('2026-10-30T12:00:00.000Z');

function row(overrides: Partial<SourceHealthRow> = {}): SourceHealthRow {
  return {
    source: 'nextcommit',
    status: 'OK',
    lastRunAt: '2026-10-30T11:55:00.000Z',
    nextRunAt: '2026-10-30T13:55:00.000Z',
    intervalInHours: 2,
    runs: 12,
    failures: 0,
    totalFound: 131,
    ...overrides,
  };
}

function setup(
  rows: readonly SourceHealthRow[] | undefined,
  options: { isLoading?: boolean; error?: Error | null } = {},
): void {
  render(
    <SourceHealthTable
      rows={rows}
      windowInHours={24}
      now={NOW}
      isLoading={options.isLoading ?? false}
      error={options.error ?? null}
    />,
  );
}

describe('SourceHealthTable', () => {
  it('mostra a janela no subtitulo', () => {
    setup([row()]);

    expect(screen.getByText('Saude da coleta')).toBeInTheDocument();
    expect(screen.getByText('Estado de cada fonte nas ultimas 24h')).toBeInTheDocument();
  });

  it('lista a fonte com rotulo, ultima execucao, proxima, lidas e falhas', () => {
    setup([row()]);

    const cells = screen.getAllByRole('cell');

    expect(screen.getByRole('rowheader', { name: /Next Commit/ })).toBeInTheDocument();
    expect(cells[0]).toHaveTextContent('ok');
    expect(cells[1]).toHaveTextContent('ha 5 min');
    expect(cells[2]).toHaveTextContent('em 115 min (2 h)');
    expect(cells[3]).toHaveTextContent('131');
    expect(cells[4]).toHaveTextContent('0');
  });

  it('anuncia o intervalo espacado das publicacoes do LinkedIn', () => {
    setup([
      row({
        source: 'linkedin-posts',
        intervalInHours: 4,
        nextRunAt: '2026-10-30T15:55:00.000Z',
        totalFound: 5,
      }),
    ]);

    expect(screen.getByRole('rowheader', { name: /Publicação LinkedIn/ })).toBeInTheDocument();
    expect(screen.getByText('em 3 h (4 h)')).toBeInTheDocument();
  });

  it('mostra as duas fontes novas lado a lado', () => {
    setup([row(), row({ source: 'linkedin-posts', intervalInHours: 4, totalFound: 5 })]);

    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(screen.getByRole('rowheader', { name: /Next Commit/ })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: /Publicação LinkedIn/ })).toBeInTheDocument();
  });

  it('destaca a fonte que esta falhando', () => {
    setup([row({ status: 'FAILING', failures: 3 })]);

    expect(screen.getByTestId('source-status')).toHaveTextContent('falhando');
    expect(screen.getAllByRole('cell').at(-1)).toHaveClass('text-negative');
  });

  // A licao do Jobbol: respondia 200 e nao trazia nada.
  it('separa quem nao traz vagas de quem esta falhando', () => {
    setup([row({ status: 'IDLE', totalFound: 0 })]);

    expect(screen.getByTestId('source-status')).toHaveTextContent('sem vagas');
  });

  it('usa travessao e so o intervalo para a fonte que nunca rodou', () => {
    setup([row({ lastRunAt: null, nextRunAt: null, runs: 0, totalFound: 0 })]);

    const cells = screen.getAllByRole('cell');

    expect(cells[1]).toHaveTextContent('—');
    expect(cells[2]).toHaveTextContent('a cada 2 h');
  });

  it('mostra o esqueleto enquanto carrega', () => {
    setup(undefined, { isLoading: true });

    expect(screen.getByTestId('skeleton')).toBeInTheDocument();
  });

  it('explica a lista vazia antes da primeira captura', () => {
    setup([]);

    expect(screen.getByText('Nenhuma captura registrada')).toBeInTheDocument();
  });

  it('mostra o erro da consulta', () => {
    setup(undefined, { error: new Error('API fora do ar') });

    expect(screen.getByText('Nao foi possivel carregar a saude da coleta')).toBeInTheDocument();
    expect(screen.getByText('API fora do ar')).toBeInTheDocument();
  });
});
