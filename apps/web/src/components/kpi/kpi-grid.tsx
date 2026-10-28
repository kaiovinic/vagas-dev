import type { ReactNode } from 'react';
import { Briefcase, Building2, Globe2, Sparkles } from 'lucide-react';

import type { DashboardSummary } from '@/api/schemas';
import { KpiCard } from '@/components/kpi/kpi-card';
import { formatPercentage } from '@/lib/sources';

interface KpiGridProps {
  readonly summary: DashboardSummary | undefined;
  readonly isLoading: boolean;
}

/** Os 4 KPIs do topo do painel. */
export function KpiGrid({ summary, isLoading }: KpiGridProps): ReactNode {
  const windowInHours = summary?.windowInHours ?? 72;

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        label="Vagas abertas"
        value={summary?.openJobs.total}
        caption={`Publicadas nas ultimas ${windowInHours}h`}
        icon={Briefcase}
        isLoading={isLoading}
      />

      <KpiCard
        label="Novas em 24h"
        value={summary?.newInLast24h.total}
        caption={`${summary?.newInLast24h.previousTotal ?? 0} nas 24h anteriores`}
        icon={Sparkles}
        delta={summary?.newInLast24h.delta}
        deltaCaption="vs. 24h anteriores"
        isLoading={isLoading}
      />

      <KpiCard
        label="Remotas"
        value={summary?.remote.total}
        caption={
          summary === undefined
            ? 'Percentual sobre as vagas abertas'
            : `${formatPercentage(summary.remote.percentage)} das vagas abertas`
        }
        icon={Globe2}
        isLoading={isLoading}
      />

      <KpiCard
        label="Empresas contratando"
        value={summary?.hiringCompanies.total}
        caption={`Empresas distintas nas ultimas ${windowInHours}h`}
        icon={Building2}
        isLoading={isLoading}
      />
    </div>
  );
}
