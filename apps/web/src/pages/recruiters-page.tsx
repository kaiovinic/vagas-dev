import type { ReactNode } from 'react';

import { HiringEntityPanel } from '@/components/hiring/hiring-entity-panel';
import { useHiringRecruiters } from '@/hooks/use-hiring-entities';

export function RecruitersPage(): ReactNode {
  const recruiters = useHiringRecruiters();

  return (
    <HiringEntityPanel
      title="Recrutadores"
      description="Quem publicou vagas nas ultimas 72h"
      entityLabel="Recrutador"
      filterParam="recruiterName"
      entities={recruiters.data}
      isLoading={recruiters.isPending}
      error={recruiters.error}
      // So GitHub e Remotar informam quem publicou; as demais fontes nao expoem isso.
      emptyMessage="Nenhuma vaga com recrutador identificado nas ultimas 72h"
    />
  );
}
