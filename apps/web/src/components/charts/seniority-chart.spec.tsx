import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { SeniorityDistribution } from '@/api/schemas';
import {
  SeniorityChart,
  SeniorityTooltip,
  Y_AXIS_WIDTH,
  chartDomain,
  formatBarLabel,
  toRows,
  toggleLevel,
  visibleLevels,
} from '@/components/charts/seniority-chart';
import type { SeniorityFilters } from '@/hooks/use-seniority-distribution';
import { SENIORITY_LEVEL_IDS, seniorityColor } from '@/lib/seniority';

const FILTERS: SeniorityFilters = { year: 2026, month: null, day: null, levels: [] };

const DISTRIBUTION: SeniorityDistribution = {
  year: 2026,
  month: null,
  day: null,
  timeZone: 'America/Bahia',
  start: '2026-01-01T03:00:00.000Z',
  end: '2027-01-01T03:00:00.000Z',
  total: 100,
  filteredTotal: 100,
  levels: [
    { id: 'INTERN', label: 'Estagio', total: 5, percentage: 5 },
    { id: 'JUNIOR', label: 'Junior', total: 15, percentage: 15 },
    { id: 'MID', label: 'Pleno', total: 30, percentage: 30 },
    { id: 'SENIOR', label: 'Senior', total: 20, percentage: 20 },
    { id: 'LEAD', label: 'Lead/Especialista', total: 10, percentage: 10 },
    { id: 'UNSPECIFIED', label: 'Nao especificado', total: 20, percentage: 20 },
  ],
};

function renderChartWithDom(
  overrides: Partial<Parameters<typeof SeniorityChart>[0]> = {},
): ReturnType<typeof render> {
  return render(
    <SeniorityChart
      filters={FILTERS}
      onFiltersChange={vi.fn()}
      distribution={DISTRIBUTION}
      isLoading={false}
      isRefreshing={false}
      error={null}
      currentYear={2026}
      {...overrides}
    />,
  );
}

function renderChart(
  overrides: Partial<Parameters<typeof SeniorityChart>[0]> = {},
): ReturnType<typeof vi.fn> {
  const onFiltersChange = vi.fn();

  render(
    <SeniorityChart
      filters={FILTERS}
      onFiltersChange={onFiltersChange}
      distribution={DISTRIBUTION}
      isLoading={false}
      isRefreshing={false}
      error={null}
      currentYear={2026}
      {...overrides}
    />,
  );

  return onFiltersChange;
}

describe('SeniorityChart', () => {
  describe('renderizacao', () => {
    it('anuncia o recorte: captura, no horario de Brasilia', () => {
      renderChart();

      expect(
        screen.getByRole('heading', { name: 'Vagas por Senioridade' }),
      ).toBeInTheDocument();
      expect(screen.getByText('Por data de captura, no horario de Brasilia')).toBeInTheDocument();
    });

    it('desenha uma barra por nivel recebido', () => {
      const { container } = renderChartWithDom();

      expect(screen.getByTestId('seniority-chart')).toBeInTheDocument();
      expect(container.querySelectorAll('.recharts-rectangle')).toHaveLength(
        DISTRIBUTION.levels.length,
      );
    });

    it('diz quanto do periodo o filtro esta mostrando', () => {
      renderChart({ distribution: { ...DISTRIBUTION, filteredTotal: 50 } });

      expect(screen.getByTestId('seniority-total')).toHaveTextContent(
        '50 de 100 vagas capturadas no periodo',
      );
    });

    it('mostra o esqueleto enquanto carrega', () => {
      renderChart({ isLoading: true });

      expect(screen.getByTestId('skeleton')).toBeInTheDocument();
      expect(screen.queryByTestId('seniority-chart')).not.toBeInTheDocument();
    });

    /** Mensagem propria: a falha da senioridade nao e a dos graficos por fonte. */
    it('mostra a falha com a mensagem da api', () => {
      renderChart({ error: new Error('Parametros invalidos') });

      expect(screen.getByText('Nao foi possivel carregar a senioridade')).toBeInTheDocument();
      expect(screen.getByText('Parametros invalidos')).toBeInTheDocument();
    });

    it('avisa quando o periodo nao capturou nada', () => {
      renderChart({
        distribution: {
          ...DISTRIBUTION,
          total: 0,
          filteredTotal: 0,
          levels: DISTRIBUTION.levels.map((level) => ({ ...level, total: 0, percentage: 0 })),
        },
      });

      expect(screen.getByText('Sem vagas capturadas no periodo')).toBeInTheDocument();
    });

    it('avisa quando o filtro escondeu todos os niveis', () => {
      renderChart({ distribution: { ...DISTRIBUTION, levels: [], filteredTotal: 0 } });

      expect(screen.getByText('Nenhum nivel selecionado')).toBeInTheDocument();
    });

    it('deita as barras: a contagem no eixo X e os niveis no eixo Y', () => {
      const { container } = renderChartWithDom();

      const rotulosY = [
        ...container.querySelectorAll('.recharts-yAxis .recharts-cartesian-axis-tick-value'),
      ].map((tick) => tick.textContent);

      // Os nomes dos niveis saem do eixo horizontal e passam para o vertical.
      expect(rotulosY).toEqual([
        'Estágio',
        'Júnior',
        'Pleno',
        'Sênior',
        'Lead/Especialista',
        'Não especificado',
      ]);
    });

    it('reserva largura para o rotulo mais longo da escala', () => {
      // "Lead/Especialista" a 11px pede por volta de 100px.
      expect(Y_AXIS_WIDTH).toBeGreaterThanOrEqual(110);
    });

    /**
     * O `<Text>` do Recharts quebraria "Nao especificado" no espaco; o tick
     * proprio nao tem como. A ausencia de `<tspan>` e a prova de linha unica.
     */
    it('escreve cada rotulo do eixo em uma linha so', () => {
      const { container } = renderChartWithDom();

      const ticks = [
        ...container.querySelectorAll('.recharts-yAxis .recharts-cartesian-axis-tick-value'),
      ];

      expect(ticks).toHaveLength(6);
      expect(ticks.some((tick) => tick.querySelector('tspan') !== null)).toBe(false);
    });

    it('da a cada nivel a sua cor, na ordem das barras', () => {
      const { container } = renderChartWithDom();

      const cores = [...container.querySelectorAll('.recharts-rectangle')].map((bar) =>
        bar.getAttribute('fill'),
      );

      expect(cores).toEqual(SENIORITY_LEVEL_IDS.map((id) => seniorityColor(id)));
    });

    /** Uma cor so para todas as barras era o desenho anterior. */
    it('nao pinta duas barras com a mesma cor', () => {
      const { container } = renderChartWithDom();

      const cores = [...container.querySelectorAll('.recharts-rectangle')].map((bar) =>
        bar.getAttribute('fill'),
      );

      expect(new Set(cores).size).toBe(cores.length);
    });

    it('mostra o numero no fim de cada barra', () => {
      const { container } = renderChartWithDom();

      const rotulos = [...container.querySelectorAll('.recharts-label-list text')].map(
        (label) => label.textContent,
      );

      expect(rotulos).toEqual(['5', '15', '30', '20', '10', '20']);
    });

    it('esmaece o grafico anterior enquanto o novo recorte carrega', () => {
      renderChart({ isRefreshing: true });

      expect(screen.getByTestId('seniority-chart')).toHaveClass('opacity-60');
    });
  });

  describe('seletores de calendario', () => {
    it('comeca no ano corrente, com todos os meses e todos os dias', () => {
      renderChart();

      expect(screen.getByLabelText('Ano do grafico')).toHaveValue('2026');
      expect(screen.getByLabelText('Mes do grafico')).toHaveValue('');
      expect(screen.getByLabelText('Dia do grafico')).toHaveValue('');
    });

    it('oferece os cinco ultimos anos', () => {
      renderChart();

      const options = screen.getByLabelText('Ano do grafico').querySelectorAll('option');

      expect([...options].map((option) => option.textContent)).toEqual([
        '2026',
        '2025',
        '2024',
        '2023',
        '2022',
      ]);
    });

    it('troca o ano', async () => {
      const onFiltersChange = renderChart();

      await userEvent.selectOptions(screen.getByLabelText('Ano do grafico'), '2025');

      expect(onFiltersChange).toHaveBeenCalledWith({ ...FILTERS, year: 2025 });
    });

    it('troca o mes', async () => {
      const onFiltersChange = renderChart();

      await userEvent.selectOptions(screen.getByLabelText('Mes do grafico'), '3');

      expect(onFiltersChange).toHaveBeenCalledWith({ ...FILTERS, month: 3 });
    });

    /** Dia sem mes a API recusa; o seletor diz isso antes da requisicao. */
    it('mantem o seletor de dia desabilitado enquanto o mes for "todos"', () => {
      renderChart();

      expect(screen.getByLabelText('Dia do grafico')).toBeDisabled();
    });

    it('libera os dias do mes escolhido', () => {
      renderChart({ filters: { ...FILTERS, month: 2 } });

      const day = screen.getByLabelText('Dia do grafico');

      expect(day).toBeEnabled();
      // 2026 nao e bissexto: 28 dias mais a opcao "todos os dias".
      expect(day.querySelectorAll('option')).toHaveLength(29);
    });

    it('troca o dia', async () => {
      const onFiltersChange = renderChart({ filters: { ...FILTERS, month: 10 } });

      await userEvent.selectOptions(screen.getByLabelText('Dia do grafico'), '26');

      expect(onFiltersChange).toHaveBeenCalledWith({ ...FILTERS, month: 10, day: 26 });
    });

    it('limpa o dia ao voltar para "todos os meses"', async () => {
      const onFiltersChange = renderChart({ filters: { ...FILTERS, month: 10, day: 26 } });

      await userEvent.selectOptions(screen.getByLabelText('Mes do grafico'), '');

      expect(onFiltersChange).toHaveBeenCalledWith({ ...FILTERS, month: null, day: null });
    });

    /** 29 de fevereiro existe em 2024 e nao em 2026. */
    it('encurta o dia quando o novo ano deixa o mes mais curto', async () => {
      const onFiltersChange = renderChart({
        filters: { ...FILTERS, year: 2024, month: 2, day: 29 },
        currentYear: 2026,
      });

      await userEvent.selectOptions(screen.getByLabelText('Ano do grafico'), '2026');

      expect(onFiltersChange).toHaveBeenCalledWith({
        ...FILTERS,
        year: 2026,
        month: 2,
        day: 28,
      });
    });

    it('encurta o dia quando o novo mes e mais curto', async () => {
      const onFiltersChange = renderChart({ filters: { ...FILTERS, month: 1, day: 31 } });

      await userEvent.selectOptions(screen.getByLabelText('Mes do grafico'), '2');

      expect(onFiltersChange).toHaveBeenCalledWith({ ...FILTERS, month: 2, day: 28 });
    });
  });

  describe('filtro de senioridade', () => {
    it('mostra os seis niveis marcados quando nada foi filtrado', () => {
      renderChart();

      const chips = screen.getAllByRole('button', { pressed: true });

      expect(chips.map((chip) => chip.textContent)).toEqual([
        'Estágio',
        'Júnior',
        'Pleno',
        'Sênior',
        'Lead/Especialista',
        'Não especificado',
      ]);
    });

    it('desmarcar um nivel manda a lista sem ele', async () => {
      const onFiltersChange = renderChart();

      await userEvent.click(screen.getByRole('button', { name: 'Estágio' }));

      expect(onFiltersChange).toHaveBeenCalledWith({
        ...FILTERS,
        levels: ['JUNIOR', 'MID', 'SENIOR', 'LEAD', 'UNSPECIFIED'],
      });
    });

    it('marcar um nivel o acrescenta a lista filtrada', async () => {
      const onFiltersChange = renderChart({ filters: { ...FILTERS, levels: ['MID'] } });

      await userEvent.click(screen.getByRole('button', { name: 'Sênior' }));

      expect(onFiltersChange).toHaveBeenCalledWith({ ...FILTERS, levels: ['MID', 'SENIOR'] });
    });

    it('da ao chip marcado a bolinha na cor da propria barra', () => {
      renderChart();

      for (const id of SENIORITY_LEVEL_IDS) {
        expect(screen.getByTestId(`seniority-dot-${id}`)).toHaveStyle({
          backgroundColor: seniorityColor(id),
        });
      }
    });

    /** Bolinha colorida num chip desmarcado diria que o nivel esta no grafico. */
    it('apaga a bolinha do chip desmarcado', () => {
      renderChart({ filters: { ...FILTERS, levels: ['MID'] } });

      expect(screen.getByTestId('seniority-dot-MID')).toHaveStyle({
        backgroundColor: seniorityColor('MID'),
      });
      expect(screen.getByTestId('seniority-dot-SENIOR')).toHaveStyle({
        backgroundColor: 'var(--color-content-muted)',
      });
    });

    it('mostra como desmarcados os niveis fora do filtro', () => {
      renderChart({ filters: { ...FILTERS, levels: ['MID'] } });

      expect(screen.getByRole('button', { name: 'Pleno' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(screen.getByRole('button', { name: 'Sênior' })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    });
  });
});

describe('chartDomain', () => {
  it('abre folga no fim do eixo para o rotulo da maior barra', () => {
    expect(chartDomain(toRows(DISTRIBUTION))).toEqual([0, 35]);
  });

  it('da escala minima ao periodo todo zerado', () => {
    const zerado = toRows({
      ...DISTRIBUTION,
      levels: DISTRIBUTION.levels.map((level) => ({ ...level, total: 0, percentage: 0 })),
    });

    expect(chartDomain(zerado)).toEqual([0, 1]);
  });

  it('nao quebra com nenhuma linha', () => {
    expect(chartDomain([])).toEqual([0, 1]);
  });
});

describe('visibleLevels', () => {
  it('trata a lista vazia como todos os niveis', () => {
    expect(visibleLevels([])).toEqual(new Set(SENIORITY_LEVEL_IDS));
  });

  it('respeita a lista quando ela vem preenchida', () => {
    expect(visibleLevels(['MID'])).toEqual(new Set(['MID']));
  });
});

describe('toggleLevel', () => {
  it('remove o nivel marcado', () => {
    expect(toggleLevel(new Set(['MID', 'SENIOR']), 'MID')).toEqual(['SENIOR']);
  });

  it('acrescenta o nivel desmarcado, na ordem canonica', () => {
    expect(toggleLevel(new Set(['SENIOR']), 'MID')).toEqual(['MID', 'SENIOR']);
  });

  /** Seis de seis e o mesmo que nenhum filtro, e a URL fica limpa. */
  it('volta a lista vazia quando todos ficam marcados', () => {
    const quaseTodos = new Set(SENIORITY_LEVEL_IDS.filter((id) => id !== 'MID'));

    expect(toggleLevel(quaseTodos, 'MID')).toEqual([]);
  });
});

describe('toRows', () => {
  it('troca o rotulo da api pelo acentuado da interface', () => {
    expect(toRows(DISTRIBUTION).map((row) => row.label)).toEqual([
      'Estágio',
      'Júnior',
      'Pleno',
      'Sênior',
      'Lead/Especialista',
      'Não especificado',
    ]);
  });

  it('mantem o rotulo da api para nivel que a interface ainda nao conhece', () => {
    const rows = toRows({
      ...DISTRIBUTION,
      levels: [{ id: 'ARQUITETO', label: 'Arquiteto', total: 1, percentage: 1 }],
    });

    expect(rows[0]?.label).toBe('Arquiteto');
  });
});

describe('formatBarLabel', () => {
  it.each([
    [30, '30'],
    [1, '1'],
  ])('mostra %s como %s', (value, expected) => {
    expect(formatBarLabel(value)).toBe(expected);
  });

  it.each([[0], ['texto'], [undefined]])('esconde o rotulo de %s', (value) => {
    expect(formatBarLabel(value)).toBe('');
  });
});

describe('SeniorityTooltip', () => {
  it('mostra nivel, quantidade e percentual', () => {
    render(
      <SeniorityTooltip
        active
        row={{ id: 'MID', label: 'Pleno', total: 30, percentage: 30 }}
      />,
    );

    expect(screen.getByTestId('seniority-tooltip')).toHaveTextContent('Pleno');
    expect(screen.getByTestId('seniority-tooltip')).toHaveTextContent('30 vagas');
    expect(screen.getByTestId('seniority-tooltip')).toHaveTextContent('30%');
  });

  it('repete no tooltip a cor da barra', () => {
    const { container } = render(
      <SeniorityTooltip active row={{ id: 'LEAD', label: 'Lead', total: 2, percentage: 2 }} />,
    );

    expect(container.querySelector('span[aria-hidden="true"]')).toHaveStyle({
      backgroundColor: seniorityColor('LEAD'),
    });
  });

  it('usa o singular para uma vaga', () => {
    render(
      <SeniorityTooltip active row={{ id: 'LEAD', label: 'Lead', total: 1, percentage: 1 }} />,
    );

    expect(screen.getByTestId('seniority-tooltip')).toHaveTextContent('1 vaga ·');
  });

  it('nao renderiza nada fora do hover', () => {
    const { container } = render(
      <SeniorityTooltip active={false} row={{ id: 'MID', label: 'Pleno', total: 3, percentage: 3 }} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('nao renderiza nada sem linha', () => {
    const { container } = render(<SeniorityTooltip active row={undefined} />);

    expect(container).toBeEmptyDOMElement();
  });
});
