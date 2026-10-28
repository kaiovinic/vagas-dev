import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { DashboardSummary } from '@/api/schemas';
import { KpiGrid } from '@/components/kpi/kpi-grid';

function summary(overrides: Partial<DashboardSummary> = {}): DashboardSummary {
  return {
    windowInHours: 72,
    capture: {
      lastCaptureAt: null,
      nextCaptureAt: null,
      status: null,
      failedSources: [],
    },
    openJobs: { total: 1240 },
    newInLast24h: { total: 12, previousTotal: 9, delta: 3 },
    remote: { total: 30, percentage: 71.4 },
    hiringCompanies: { total: 17 },
    ...overrides,
  };
}

describe('KpiGrid', () => {
  it('mostra os quatro cards de KPI', () => {
    render(<KpiGrid summary={summary()} isLoading={false} />);

    expect(screen.getAllByRole('article')).toHaveLength(4);
    expect(screen.getByText('Vagas abertas')).toBeInTheDocument();
    expect(screen.getByText('Novas em 24h')).toBeInTheDocument();
    expect(screen.getByText('Remotas')).toBeInTheDocument();
    expect(screen.getByText('Empresas contratando')).toBeInTheDocument();
  });

  it('formata numeros grandes no padrao pt-BR', () => {
    render(<KpiGrid summary={summary()} isLoading={false} />);

    expect(screen.getByText('1.240')).toBeInTheDocument();
  });

  it('cita a janela de 72h nas legendas', () => {
    render(<KpiGrid summary={summary()} isLoading={false} />);

    expect(screen.getByText('Publicadas nas ultimas 72h')).toBeInTheDocument();
    expect(screen.getByText('Empresas distintas nas ultimas 72h')).toBeInTheDocument();
  });

  it('mostra a variacao positiva vs. 24h anteriores', () => {
    render(<KpiGrid summary={summary()} isLoading={false} />);

    expect(screen.getByTestId('kpi-delta')).toHaveTextContent('+3 vs. 24h anteriores');
    expect(screen.getByText('9 nas 24h anteriores')).toBeInTheDocument();
  });

  it('mostra a variacao negativa sem sinal duplicado', () => {
    render(
      <KpiGrid
        summary={summary({ newInLast24h: { total: 4, previousTotal: 11, delta: -7 } })}
        isLoading={false}
      />,
    );

    expect(screen.getByTestId('kpi-delta')).toHaveTextContent('-7 vs. 24h anteriores');
  });

  it('mostra variacao estavel sem sinal', () => {
    render(
      <KpiGrid
        summary={summary({ newInLast24h: { total: 9, previousTotal: 9, delta: 0 } })}
        isLoading={false}
      />,
    );

    expect(screen.getByTestId('kpi-delta')).toHaveTextContent('0 vs. 24h anteriores');
  });

  it('mostra o percentual de remotas sobre as vagas abertas', () => {
    render(<KpiGrid summary={summary()} isLoading={false} />);

    expect(screen.getByText('71,4% das vagas abertas')).toBeInTheDocument();
  });

  it('exibe skeleton enquanto carrega', () => {
    render(<KpiGrid summary={undefined} isLoading />);

    expect(screen.getAllByTestId('skeleton')).toHaveLength(4);
    expect(screen.queryByTestId('kpi-delta')).not.toBeInTheDocument();
  });

  it('usa a janela padrao de 72h antes de a api responder', () => {
    render(<KpiGrid summary={undefined} isLoading />);

    expect(screen.getByText('Publicadas nas ultimas 72h')).toBeInTheDocument();
    expect(screen.getByText('Percentual sobre as vagas abertas')).toBeInTheDocument();
  });
});
