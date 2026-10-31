import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';

import logoUrl from '@/assets/logo.svg';
import type { DashboardSummary } from '@/api/schemas';
import { CaptureButton } from '@/components/layout/capture-button';
import { CaptureStatus } from '@/components/layout/capture-status';
import { NAVIGATION_TABS } from '@/components/layout/navigation';

const PILL_BASE =
  'rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors whitespace-nowrap';

interface AppHeaderProps {
  readonly capture: DashboardSummary['capture'] | undefined;
}

export function AppHeader({ capture }: AppHeaderProps): ReactNode {
  return (
    <header className="border-b border-border-subtle bg-surface-raised/60 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {/* O proprio logo ja traz o simbolo e o nome; o `alt` e o nome acessivel do h1. */}
            <h1 className="flex items-center">
              {/* shrink-0: sem isso o flex comprime a imagem e corta o "DEV" do logo. */}
              <img src={logoUrl} alt="Vagas Dev BA/Remoto" className="h-11 w-auto shrink-0" />
            </h1>
            <p className="hidden max-w-44 text-xs leading-tight text-content-muted lg:block">
              Frontend e Fullstack na Bahia e 100% remotas
            </p>
          </div>

          <nav aria-label="Secoes do painel">
            <ul className="flex flex-wrap items-center gap-1.5 rounded-full bg-surface-base/70 p-1.5">
              {NAVIGATION_TABS.map((tab) => (
                <li key={tab.path}>
                  <NavLink
                    to={tab.path}
                    className={({ isActive }) =>
                      `${PILL_BASE} ${
                        isActive
                          ? 'bg-accent text-surface-base shadow'
                          : 'text-content-secondary hover:bg-surface-overlay hover:text-content-primary'
                      }`
                    }
                  >
                    {tab.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <CaptureStatus capture={capture} />
          <CaptureButton />
        </div>
      </div>
    </header>
  );
}
