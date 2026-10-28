import type { ReactNode } from 'react';

import { HiringEntityPanel } from '@/components/hiring/hiring-entity-panel';
import { useHiringCompanies } from '@/hooks/use-hiring-entities';

export function CompaniesPage(): ReactNode {
  const companies = useHiringCompanies();

  return (
    <HiringEntityPanel
      title="Empresas contratando"
      description="Empresas com vagas abertas nas ultimas 72h"
      entityLabel="Empresa"
      filterParam="company"
      entities={companies.data}
      isLoading={companies.isPending}
      error={companies.error}
      emptyMessage="Nenhuma empresa contratando nas ultimas 72h"
    />
  );
}
