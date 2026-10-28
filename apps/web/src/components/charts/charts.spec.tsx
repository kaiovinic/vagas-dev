import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { DailyStack, SourceSlice } from '@/api/schemas';
import { DailyStackedBarChart } from '@/components/charts/daily-stacked-bar-chart';
import { SourceDonutChart } from '@/components/charts/source-donut-chart';

const SLICES: SourceSlice[] = [
  { source: 'linkedin', total: 6, percentage: 60 },
  { source: 'gupy', total: 2, percentage: 20 },
  { source: 'desconhecida', total: 2, percentage: 20 },
];

const BY_DAY: DailyStack[] = [
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
];

describe('SourceDonutChart', () => {
  it('usa o titulo e o subtitulo do painel de referencia', () => {
    render(
      <SourceDonutChart slices={SLICES} windowInHours={72} isLoading={false} error={null} />,
    );

    expect(screen.getByRole('heading', { name: 'Qual site tem mais vagas' })).toBeInTheDocument();
    expect(
      screen.getByText('Vagas abertas das ultimas 72h, por fonte'),
    ).toBeInTheDocument();
  });

  it('mostra quantidade e percentual de cada fonte na legenda', () => {
    render(
      <SourceDonutChart slices={SLICES} windowInHours={72} isLoading={false} error={null} />,
    );

    const legend = screen.getByTestId('donut-legend');

    expect(legend).toHaveTextContent('LinkedIn');
    expect(legend).toHaveTextContent('6');
    expect(legend).toHaveTextContent('60%');
    expect(legend).toHaveTextContent('Gupy');
    expect(legend).toHaveTextContent('20%');
  });

  it('capitaliza fontes que ainda nao tem rotulo proprio', () => {
    render(
      <SourceDonutChart slices={SLICES} windowInHours={72} isLoading={false} error={null} />,
    );

    expect(screen.getByTestId('donut-legend')).toHaveTextContent('Desconhecida');
  });

  it('desenha uma fatia por fonte na rosca', () => {
    const { container } = render(
      <SourceDonutChart slices={SLICES} windowInHours={72} isLoading={false} error={null} />,
    );

    expect(screen.getByTestId('donut-chart')).toBeInTheDocument();
    expect(container.querySelectorAll('.recharts-pie-sector')).toHaveLength(SLICES.length);
  });

  it('exibe skeleton enquanto carrega', () => {
    render(
      <SourceDonutChart slices={undefined} windowInHours={72} isLoading error={null} />,
    );

    expect(screen.getByTestId('skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('donut-legend')).not.toBeInTheDocument();
  });

  it('avisa quando nao ha vaga aberta', () => {
    render(<SourceDonutChart slices={[]} windowInHours={72} isLoading={false} error={null} />);

    expect(screen.getByText('Nenhuma vaga aberta no momento')).toBeInTheDocument();
  });

  it('mostra a mensagem de erro da api', () => {
    render(
      <SourceDonutChart
        slices={undefined}
        windowInHours={72}
        isLoading={false}
        error={new Error('API fora do ar')}
      />,
    );

    expect(screen.getByText('Nao foi possivel carregar o grafico')).toBeInTheDocument();
    expect(screen.getByText('API fora do ar')).toBeInTheDocument();
  });
});

function renderStacked(
  overrides: Partial<Parameters<typeof DailyStackedBarChart>[0]> = {},
): { onDaysChange: ReturnType<typeof vi.fn>; container: HTMLElement } {
  const onDaysChange = vi.fn();

  const { container } = render(
    <DailyStackedBarChart
      days={14}
      onDaysChange={onDaysChange}
      sources={['gupy', 'linkedin']}
      byDay={BY_DAY}
      isLoading={false}
      isRefreshing={false}
      error={null}
      {...overrides}
    />,
  );

  return { onDaysChange, container };
}

describe('DailyStackedBarChart', () => {
  it('usa o titulo e o subtitulo do painel de referencia', () => {
    renderStacked();

    expect(screen.getByRole('heading', { name: 'Vagas novas por dia' })).toBeInTheDocument();
    expect(
      screen.getByText('Por dia de publicacao no horario de Brasilia, empilhadas por fonte'),
    ).toBeInTheDocument();
  });

  it('mostra o seletor com 14 dias selecionado', () => {
    renderStacked();

    const select = screen.getByLabelText('Periodo do grafico');

    expect(select).toHaveValue('14');
    expect(screen.getByRole('option', { name: '7 dias' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '14 dias' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '30 dias' })).toBeInTheDocument();
  });

  it('avisa a troca de periodo', async () => {
    const { onDaysChange } = renderStacked();

    await userEvent.selectOptions(screen.getByLabelText('Periodo do grafico'), '30');

    expect(onDaysChange).toHaveBeenCalledWith(30);
  });

  it('desenha uma pilha por fonte, empilhadas no mesmo dia', () => {
    const { container } = renderStacked();

    expect(screen.getByTestId('stacked-bar-chart')).toBeInTheDocument();
    // Uma serie (grupo de barras) por fonte, empilhadas pelo mesmo stackId.
    expect(container.querySelectorAll('.recharts-bar')).toHaveLength(2);
    expect(container.querySelectorAll('.recharts-rectangle').length).toBeGreaterThan(0);
  });

  it('comeca com a tabela recolhida', () => {
    renderStacked();

    expect(screen.getByRole('button', { name: /Ver tabela/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('abre e fecha a tabela pelo botao', async () => {
    renderStacked();

    const toggle = screen.getByRole('button', { name: /Ver tabela/ });

    await userEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('table')).toBeInTheDocument();

    await userEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('lista um dia por linha, com uma coluna por fonte e o total', async () => {
    renderStacked();

    await userEvent.click(screen.getByRole('button', { name: /Ver tabela/ }));

    expect(screen.getByRole('columnheader', { name: 'Gupy' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'LinkedIn' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Total' })).toBeInTheDocument();

    const rows = screen.getAllByRole('row');

    // Cabecalho + um dia por linha.
    expect(rows).toHaveLength(BY_DAY.length + 1);
    expect(rows[1]).toHaveTextContent('25/10');
    expect(rows[2]).toHaveTextContent('26/10');
  });

  it('preenche com zero a fonte sem vaga no dia', async () => {
    renderStacked();

    await userEvent.click(screen.getByRole('button', { name: /Ver tabela/ }));

    // 26/10 tem 1 na Gupy e nada no LinkedIn.
    expect(screen.getAllByRole('row')[2]).toHaveTextContent('0');
  });

  it('exibe skeleton enquanto carrega', () => {
    renderStacked({ isLoading: true, byDay: undefined, sources: undefined });

    expect(screen.getByTestId('skeleton')).toBeInTheDocument();
  });

  it('esmaece o grafico anterior enquanto o novo periodo carrega', () => {
    renderStacked({ isRefreshing: true });

    expect(screen.getByTestId('stacked-bar-chart')).toHaveClass('opacity-60');
  });

  it('avisa quando o periodo nao tem vagas', () => {
    renderStacked({ byDay: [] });

    expect(screen.getByText('Sem vagas publicadas no periodo')).toBeInTheDocument();
  });

  it('avisa na tabela quando o periodo nao tem vagas', async () => {
    renderStacked({ byDay: [] });

    await userEvent.click(screen.getByRole('button', { name: /Ver tabela/ }));

    expect(screen.getByText('Nada para listar neste periodo')).toBeInTheDocument();
  });

  it('mostra a mensagem de erro da api', () => {
    renderStacked({ error: new Error('API fora do ar') });

    expect(screen.getByText('Nao foi possivel carregar o grafico')).toBeInTheDocument();
    expect(screen.getByText('API fora do ar')).toBeInTheDocument();
  });
});
