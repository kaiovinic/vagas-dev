import { useEffect, useState } from 'react';

/** Mesmo ponto de corte do `lg:` do Tailwind, onde o split view aparece. */
export const DESKTOP_QUERY = '(min-width: 1024px)';

/**
 * Observa uma media query.
 *
 * Existe porque esconder com CSS nao basta: o drawer do celular e um
 * `role="dialog"` com o mesmo conteudo do painel fixo. Escondido por
 * `lg:hidden`, ele continua no DOM e o leitor de tela anuncia a vaga duas
 * vezes no desktop. Quem decide montar precisa saber a largura.
 *
 * Em ambiente sem `matchMedia` (jsdom antigo, SSR) devolve `false`, que e o
 * caminho conservador: monta o drawer, que funciona em qualquer largura.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => matchesNow(query));

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }

    const list = window.matchMedia(query);
    const onChange = (): void => setMatches(list.matches);

    onChange();
    list.addEventListener('change', onChange);

    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

function matchesNow(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }

  return window.matchMedia(query).matches;
}
