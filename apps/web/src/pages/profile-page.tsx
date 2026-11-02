import type { ReactNode } from 'react';
import { CircleAlert, CircleCheck } from 'lucide-react';

import { ProfileForm } from '@/components/profile/profile-form';
import { Panel, Skeleton, StateMessage } from '@/components/ui/panel';
import { useCandidateProfile } from '@/hooks/use-candidate-profile';

/**
 * Aba `Perfil`: a materia-prima do gerador de curriculo. O aviso de prontidao
 * fica no topo porque e o que decide se o gerador tem com que trabalhar.
 */
export function ProfilePage(): ReactNode {
  const profile = useCandidateProfile();

  if (profile.error !== null) {
    return (
      <Panel title="Perfil">
        <StateMessage
          title="Nao foi possivel carregar o perfil"
          description={profile.error.message}
          tone="negative"
        />
      </Panel>
    );
  }

  if (profile.isPending) {
    return (
      <Panel title="Perfil" description="Seus dados, como o gerador de curriculo vai le-los">
        <div className="flex flex-col gap-3">
          {[0, 1, 2, 3].map((row) => (
            <Skeleton key={row} className="h-20 w-full" />
          ))}
        </div>
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <ReadinessBanner isUsable={profile.data.isUsableForResume} />
      <ProfileForm data={profile.data} />
    </div>
  );
}

function ReadinessBanner({ isUsable }: { readonly isUsable: boolean }): ReactNode {
  const tone = isUsable
    ? 'border-positive/40 text-positive'
    : 'border-border-subtle text-content-secondary';

  return (
    <p
      data-testid="profile-readiness"
      className={`flex items-center gap-2 rounded-xl border bg-surface-raised px-4 py-3 text-sm ${tone}`}
    >
      {isUsable ? (
        <CircleCheck aria-hidden="true" className="size-4 shrink-0" />
      ) : (
        <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
      )}
      {isUsable
        ? 'Perfil pronto para gerar curriculo sob medida.'
        : 'Informe ao menos uma experiencia e um grupo de competencias para o gerador de curriculo funcionar.'}
    </p>
  );
}
