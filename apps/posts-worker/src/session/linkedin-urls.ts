/**
 * Leitura de URL do LinkedIn, sem navegador.
 *
 * Mora separado do `linkedin-session` de proposito: e a unica parte da sessao
 * que da para testar sem abrir Chromium, e e a que mais vai mudar — o LinkedIn
 * inventa caminho novo de desafio de vez em quando.
 */

export const LINKEDIN_BASE_URL = 'https://www.linkedin.com';

export const FEED_URL = `${LINKEDIN_BASE_URL}/feed/`;

export const LOGIN_URL = `${LINKEDIN_BASE_URL}/login`;

/**
 * Onde o LinkedIn para quem nao esta logado.
 *
 * `/uas/` aparece no meio do redirecionamento depois do login e tambem quando a
 * sessao e recusada; `/authwall` e a parede que ele mostra para visitante.
 */
export const SIGNED_OUT_PATHS = [
  '/login',
  '/uas/',
  '/checkpoint',
  '/challenge',
  '/authwall',
] as const;

/** True quando a URL nao e nenhuma das paradas de quem esta deslogado. */
export function isSignedIn(url: string): boolean {
  return url.startsWith(LINKEDIN_BASE_URL) && !SIGNED_OUT_PATHS.some((path) => url.includes(path));
}

/** True quando o LinkedIn pediu verificacao (2FA, captcha, confirmacao). */
export function isChallenge(url: string): boolean {
  return url.includes('/checkpoint') || url.includes('/challenge');
}
