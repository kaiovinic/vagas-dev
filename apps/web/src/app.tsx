import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { AppHeader } from '@/components/layout/app-header';
import { useDashboardSummary } from '@/hooks/use-dashboard-summary';
import { DashboardPage } from '@/pages/dashboard-page';
import { CompaniesPage } from '@/pages/companies-page';
import { MarketPage } from '@/pages/market-page';
import { JobsPage } from '@/pages/jobs-page';
import { RecruitersPage } from '@/pages/recruiters-page';
import { RulesPage } from '@/pages/rules-page';

export function App(): ReactNode {
  // O cabecalho de status acompanha o usuario em todas as abas; a query e
  // compartilhada pelo cache, entao o dashboard nao refaz a chamada.
  const summary = useDashboardSummary();

  return (
    <div className="min-h-screen bg-surface-base">
      <AppHeader capture={summary.data?.capture} />

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <Routes>
          <Route path="/" element={<Navigate replace to="/dashboard" />} />
          <Route path="/vagas" element={<JobsPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/empresas" element={<CompaniesPage />} />
          <Route path="/recrutadores" element={<RecruitersPage />} />
          <Route path="/mercado" element={<MarketPage />} />
          <Route path="/regras" element={<RulesPage />} />
          <Route path="*" element={<Navigate replace to="/dashboard" />} />
        </Routes>
      </main>
    </div>
  );
}
