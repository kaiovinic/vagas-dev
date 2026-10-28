export interface NavigationTab {
  readonly label: string;
  readonly path: string;
}

/** Abas na ordem do painel de referencia. */
export const NAVIGATION_TABS: readonly NavigationTab[] = [
  { label: 'Vagas', path: '/vagas' },
  { label: 'Dashboard', path: '/dashboard' },
  { label: 'Empresas', path: '/empresas' },
  { label: 'Recrutadores', path: '/recrutadores' },
  { label: 'Mercado', path: '/mercado' },
  { label: 'Regras', path: '/regras' },
];
