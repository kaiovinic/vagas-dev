/** Dominio onde a InHire hospeda a pagina de vagas de cada cliente. */
export const INHIRE_DOMAIN = 'inhire.app';

/**
 * O rotulo imediatamente a esquerda de `.inhire.app`.
 *
 * Sem ancora a esquerda de proposito: em `www.sympla.inhire.app` a tentativa
 * que comeca no `www` falha (o `.` nao entra na classe), o motor avanca e casa
 * em `sympla` — que e o tenant. Casar o rotulo mais a direita e justamente o
 * que se quer.
 */
const INHIRE_LINK = /[a-z0-9][a-z0-9-]{0,62}\.inhire\.app/gi;

/** Subdominio valido: o que a InHire aceita a esquerda de `.inhire.app`. */
export const TENANT_SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/;

/**
 * Subdominios que existem em `*.inhire.app` sem ser cliente nenhum.
 *
 * `api.inhire.app` e o proprio endpoint que este coletor consome: varrido sem
 * filtro, o radar se descobriria como tenant e pediria as vagas da InHire a
 * InHire. Os demais sao os nomes de servico que qualquer SaaS publica.
 */
export const INHIRE_NOT_TENANTS: readonly string[] = [
  'api',
  'app',
  'apps',
  'account',
  'accounts',
  'admin',
  'assets',
  'auth',
  'blog',
  'cdn',
  'dashboard',
  'dev',
  'docs',
  'files',
  'help',
  'homolog',
  'hom',
  'img',
  'images',
  'login',
  'mail',
  'media',
  'qa',
  'sandbox',
  'stage',
  'staging',
  'static',
  'status',
  'support',
  'test',
  'uat',
  'web',
  'www',
];

const NOT_TENANTS = new Set(INHIRE_NOT_TENANTS);

/**
 * Tenants citados nos textos informados, em minusculas e sem repeticao.
 *
 * Ordem de chegada preservada: o primeiro texto da lista — o mais recente, como
 * o repositorio ordena — manda no teto de requisicoes do ciclo.
 */
export function extractInhireTenants(texts: readonly string[]): readonly string[] {
  const found = new Set<string>();

  for (const text of texts) {
    for (const link of text.match(INHIRE_LINK) ?? []) {
      const tenant = link.slice(0, -(INHIRE_DOMAIN.length + 1)).toLowerCase();

      if (isTenant(tenant)) {
        found.add(tenant);
      }
    }
  }

  return [...found];
}

function isTenant(slug: string): boolean {
  return TENANT_SLUG.test(slug) && !NOT_TENANTS.has(slug);
}

/**
 * Semente e descobertos numa so lista, sem repetir subdominio.
 *
 * A semente vem primeiro: ela e verificada, e e ela que precisa caber no teto
 * de detalhes por ciclo quando a descoberta trouxer muita gente.
 */
export function mergeTenants(...lists: readonly (readonly string[])[]): readonly string[] {
  return [...new Set(lists.flat().map((tenant) => tenant.toLowerCase()))];
}
