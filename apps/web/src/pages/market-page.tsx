import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import type { MarketSlice } from '@/api/schemas';
import { Panel, Skeleton, StateMessage } from '@/components/ui/panel';
import { useMarketInsights } from '@/hooks/use-market-insights';
import { formatInteger, formatPercentage } from '@/lib/sources';

export function MarketPage(): ReactNode {
  const market = useMarketInsights();

  if (market.error !== null) {
    return (
      <Panel title="Mercado" description="Tendencias das vagas abertas">
        <StateMessage
          title="Nao foi possivel carregar o mercado"
          description={market.error.message}
          tone="negative"
        />
      </Panel>
    );
  }

  if (market.isPending) {
    return (
      <Panel title="Mercado" description="Tendencias das vagas abertas">
        <Skeleton className="h-64 w-full" />
      </Panel>
    );
  }

  const { openJobs, windowInHours, technologies, seniorities, workModels, scopes } = market.data;

  if (openJobs === 0) {
    return (
      <Panel title="Mercado" description={`Tendencias das vagas abertas (${windowInHours}h)`}>
        <StateMessage
          title="Sem vagas abertas para analisar"
          description="A proxima captura alimenta esta aba."
        />
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="Stacks mais pedidas"
        description={`Sobre as ${formatInteger(openJobs)} vagas abertas das ultimas ${windowInHours}h. Uma vaga pode pedir mais de uma stack.`}
      >
        <SliceBars
          slices={technologies}
          linkParam="tech"
          group="tech"
          emptyMessage="Nenhuma stack citada"
        />
      </Panel>

      <Panel
        title="Nacional x Internacional"
        description="Classificado na captura por contrato, moeda e localidade"
      >
        <SliceBars
          slices={scopes}
          linkParam="scope"
          group="scope"
          emptyMessage="Nenhuma vaga classificada"
        />
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel
          title="Senioridade"
          description="Pelo nivel declarado no titulo da vaga"
        >
          <SliceBars
            slices={[...seniorities, market.data.seniorityNotInformed]}
            linkParam="seniority"
            group="seniority"
            emptyMessage="Nenhuma vaga declara nivel"
          />
        </Panel>

        <Panel title="Modalidade" description="Remoto, presencial ou hibrido">
          <SliceBars
            slices={workModels}
            group="workmodel"
            emptyMessage="Modalidade nao informada"
          />
        </Panel>
      </div>
    </div>
  );
}

interface SliceBarsProps {
  readonly slices: readonly MarketSlice[];
  /** Quando presente, cada linha vira link para a aba Vagas com esse filtro. */
  readonly linkParam?: 'tech' | 'seniority' | 'scope';
  /** Prefixo do testid: dois blocos podem ter uma fatia com o mesmo id (UNKNOWN). */
  readonly group: string;
  readonly emptyMessage: string;
}

function SliceBars({ slices, linkParam, emptyMessage, group }: SliceBarsProps): ReactNode {
  const visible = slices.filter((slice) => slice.total > 0);

  if (visible.length === 0) {
    return <StateMessage title={emptyMessage} />;
  }

  const biggest = Math.max(...visible.map((slice) => slice.total));

  return (
    <ul className="flex flex-col gap-2">
      {visible.map((slice) => (
        <li key={slice.id} data-testid={`slice-${group}-${slice.id}`}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            {linkParam !== undefined && slice.id !== 'UNKNOWN' ? (
              <Link
                to={`/vagas?${linkParam}=${encodeURIComponent(slice.id)}`}
                className="truncate text-content-secondary hover:text-accent"
              >
                {slice.label}
              </Link>
            ) : (
              <span className="truncate text-content-secondary">{slice.label}</span>
            )}
            <span className="shrink-0 tabular-nums text-content-primary">
              {formatInteger(slice.total)}
              <span className="ml-1.5 text-xs text-content-muted">
                {formatPercentage(slice.percentage)}
              </span>
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-base">
            <div
              className="h-full rounded-full bg-accent"
              // A barra e relativa a maior fatia, para a comparacao ficar legivel.
              style={{ width: `${Math.round((slice.total / biggest) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
