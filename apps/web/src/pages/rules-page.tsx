import type { ReactNode } from 'react';
import { CheckCircle2, ShieldX } from 'lucide-react';

import type { PublicRule } from '@/api/schemas';
import { PublicationTesterForm } from '@/components/rules/publication-tester-form';
import { Panel, Skeleton, StateMessage } from '@/components/ui/panel';
import { useRules } from '@/hooks/use-rules';

const KIND_LABELS: Readonly<Record<string, string>> = {
  TIME_WINDOW: 'Janela de tempo',
  KEYWORD_ALLOW_LIST: 'Termos aceitos',
  KEYWORD_DENY_LIST: 'Termos bloqueados',
  LOCATION_ALLOW_LIST: 'Localidades aceitas',
  SCOPE_DENY_LIST: 'Mercados bloqueados',
};

export function RulesPage(): ReactNode {
  const rules = useRules();

  return (
    <div className="flex flex-col gap-6">
      <Panel
        title="Regras do filtro"
        description={
          rules.data === undefined
            ? 'Criterios publicos aplicados a toda publicacao capturada'
            : `Criterios publicos (versao ${rules.data.version}) aplicados a toda publicacao capturada`
        }
      >
        {rules.error !== null ? (
          <StateMessage
            title="Nao foi possivel carregar as regras"
            description={rules.error.message}
            tone="negative"
          />
        ) : rules.isPending ? (
          <div className="flex flex-col gap-3">
            {[0, 1, 2, 3].map((row) => (
              <Skeleton key={row} className="h-24 w-full" />
            ))}
          </div>
        ) : (
          <ol className="flex flex-col gap-3">
            {rules.data.rules.map((rule, index) => (
              <RuleCard key={rule.id} rule={rule} position={index + 1} />
            ))}
          </ol>
        )}
      </Panel>

      <PublicationTesterForm />
    </div>
  );
}

interface RuleCardProps {
  readonly rule: PublicRule;
  readonly position: number;
}

function RuleCard({ rule, position }: RuleCardProps): ReactNode {
  const isDenyList = rule.kind === 'KEYWORD_DENY_LIST';

  return (
    <li
      className="rounded-xl border border-border-subtle bg-surface-base/50 p-4"
      data-testid={`rule-${rule.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="flex items-center gap-2 font-medium text-content-primary">
          {isDenyList ? (
            <ShieldX aria-hidden="true" className="size-4 text-negative" />
          ) : (
            <CheckCircle2 aria-hidden="true" className="size-4 text-positive" />
          )}
          {position}. {rule.name}
        </h3>
        <span className="rounded-full bg-surface-overlay px-2 py-0.5 text-xs text-content-muted">
          {KIND_LABELS[rule.kind] ?? rule.kind}
        </span>
      </div>

      <p className="mt-1.5 text-sm text-content-secondary">{rule.description}</p>

      <ul className="mt-3 flex flex-wrap gap-1.5">
        {rule.criteria.map((criterion) => (
          <li
            key={criterion}
            className={`rounded-full px-2 py-0.5 text-xs ${
              isDenyList
                ? 'bg-negative/15 text-negative'
                : 'bg-surface-overlay text-content-secondary'
            }`}
          >
            {criterion}
          </li>
        ))}
      </ul>

      <p className="mt-2 text-xs text-content-muted">
        Reprova com: <code className="text-content-secondary">{rule.rejectionReason}</code>
      </p>
    </li>
  );
}
