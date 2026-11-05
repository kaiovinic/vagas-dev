/**
 * Sonda pontual: busca publicacoes no LinkedIn com a SUA sessao.
 *
 *   npm run posts:linkedin-auth --workspace @devradar/api
 *   npm run posts:linkedin-auth --workspace @devradar/api -- "estamos contratando react"
 *
 * Nao escreve no banco, nao entra na captura automatica e nao e injetado em
 * lugar nenhum: existe so para responder se a sessao autenticada devolve posts
 * de recrutador sem tomar 401 ou checkpoint.
 *
 * O coletor de producao (LinkedinPostsScraperProvider) continua indo pelo
 * indice do buscador, justamente porque raspar logado viola o acordo de uso.
 */
import 'dotenv/config';

import axios, { type AxiosResponse } from 'axios';

import { decodePostTimestamp } from '@/infra/scrapers/support/linkedin-post';

/** Consulta padrao: o par que o recrutador escreve no post de vaga. */
const DEFAULT_KEYWORDS = 'estamos contratando full stack';

/**
 * O Voyager exige que o header `csrf-token` seja igual ao cookie JSESSIONID.
 * O valor em si nao e verificado contra o servidor — o que ele checa e a
 * coincidencia entre cookie e header. Entao fixamos um, e o `li_at` do .env
 * continua sendo o unico segredo de verdade.
 */
const CSRF_TOKEN = 'ajax:0000000000000000000';

/** Chrome recente no Windows: o Voyager responde 999 a agente nao-navegador. */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * Hash da consulta GraphQL de busca. O LinkedIn rotaciona esse id sem aviso:
 * quando ele envelhece a resposta e 400. Para renovar, abra uma busca de
 * conteudo no navegador logado, filtre a aba Network por `voyagerSearchDash`
 * e copie o `queryId` para LINKEDIN_SEARCH_QUERY_ID no .env.
 */
const DEFAULT_QUERY_ID = 'voyagerSearchDashClusters.b0928897b71bd00a5d7291755c2ca9b4';

/** Rota barata e estavel, usada so para separar cookie vencido de queryId vencido. */
const ME_ENDPOINT = 'https://www.linkedin.com/voyager/api/me';

const PREVIEW_LIMIT = 3;
const TEXT_PREVIEW_LENGTH = 400;

interface PostPreview {
  readonly author: string;
  readonly text: string;
  readonly publishedAt: Date | undefined;
  readonly url: string;
}

async function main(): Promise<void> {
  const cookie = readSessionCookie();
  const keywords = process.argv.slice(2).join(' ').trim() || DEFAULT_KEYWORDS;

  await checkSession(cookie);

  console.log(`Consulta : ${keywords}`);
  console.log(`queryId  : ${queryId()}\n`);

  const response = await requestSearch(keywords, cookie);

  console.log(`HTTP ${response.status} ${response.statusText}`);

  const failure = describeFailure(response);

  if (failure) {
    console.error(`\n${failure}`);
    process.exit(1);
  }

  reportPosts(extractPosts(response.data));
}

/**
 * Confere a sessao antes da busca, contra uma rota que nao depende de hash de
 * consulta. Sem esse passo, qualquer falha adiante seria ambigua: cookie
 * vencido e `queryId` vencido devolvem corpos parecidos.
 */
async function checkSession(cookie: string): Promise<void> {
  const response = await axios.get<unknown>(ME_ENDPOINT, {
    headers: buildHeaders(cookie),
    validateStatus: () => true,
    maxRedirects: 0,
    timeout: 20_000,
  });

  console.log(`Sessao   : HTTP ${response.status} em /voyager/api/me`);

  const failure = describeFailure(response);

  if (failure) {
    console.error(`\n${failure}`);
    process.exit(1);
  }
}

/**
 * Aceita tanto `li_at=AQED...` quanto o valor cru, que e como a aba
 * Application do navegador mostra.
 */
function readSessionCookie(): string {
  const raw = (process.env.LINKEDIN_SESSION_COOKIE ?? '').trim();

  if (raw.length === 0) {
    throw new Error('LINKEDIN_SESSION_COOKIE ausente no .env');
  }

  return raw.replace(/^li_at=/i, '').replace(/^"|"$/g, '');
}

function queryId(): string {
  return process.env.LINKEDIN_SEARCH_QUERY_ID?.trim() || DEFAULT_QUERY_ID;
}

/**
 * `validateStatus` aceita tudo e `maxRedirects: 0` mantem o 302: um desvio
 * para /checkpoint/ e justamente o diagnostico que interessa aqui.
 */
async function requestSearch(keywords: string, cookie: string): Promise<AxiosResponse<unknown>> {
  return axios.get<unknown>(buildSearchUrl(keywords), {
    headers: buildHeaders(cookie),
    validateStatus: () => true,
    maxRedirects: 0,
    timeout: 20_000,
  });
}

/** Busca de CONTENT (publicacoes), ordenada pela mais recente. */
function buildSearchUrl(keywords: string): string {
  const variables =
    `(start:0,origin:GLOBAL_SEARCH_HEADER,query:(keywords:${encodeURIComponent(keywords)},` +
    'flagshipSearchIntent:SEARCH_SRP,queryParameters:List(' +
    '(key:resultType,value:List(CONTENT)),(key:sortBy,value:List(date_posted))),' +
    'includeFiltersInResponse:false))';

  return `https://www.linkedin.com/voyager/api/graphql?variables=${variables}&queryId=${queryId()}`;
}

function buildHeaders(cookie: string): Record<string, string> {
  return {
    accept: 'application/vnd.linkedin.normalized+json+2.1',
    'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8',
    cookie: `li_at=${cookie}; JSESSIONID="${CSRF_TOKEN}"`,
    'csrf-token': CSRF_TOKEN,
    referer: 'https://www.linkedin.com/search/results/content/',
    'user-agent': USER_AGENT,
    'x-li-lang': 'pt_BR',
    'x-restli-protocol-version': '2.0.0',
  };
}

/** Devolve a explicacao quando a resposta nao serve; `undefined` quando serve. */
function describeFailure(response: AxiosResponse<unknown>): string | undefined {
  const location = String(response.headers.location ?? '');

  if (/checkpoint|challenge/i.test(location)) {
    return (
      `LinkedIn pediu verificacao: ${location}\n` +
      'Entre pelo navegador, resolva o desafio e copie o li_at novo.'
    );
  }

  if (isSessionRevoked(response)) {
    return (
      'O LinkedIn derrubou a sessao: a resposta manda apagar o li_at.\n' +
      'Entre de novo pelo navegador e copie o cookie li_at novo para o .env.\n' +
      'Costuma acontecer depois de varias chamadas seguidas fora do navegador.'
    );
  }

  if (response.status === 401 || response.status === 403) {
    return 'Sessao expirada ou invalida. Renove LINKEDIN_SESSION_COOKIE com o li_at atual.';
  }

  if (response.status === 999 || response.status === 429) {
    return (
      'LinkedIn bloqueou a requisicao (anti-bot ou limite de taxa). ' +
      'Espere e repita com menos frequencia.'
    );
  }

  // 400 e 500 sao as duas caras do mesmo problema: o LinkedIn so aceita
  // consultas persistidas, e aposenta o hash a cada build do cliente web.
  if (response.status === 400 || response.status === 500) {
    return (
      `queryId recusado (${response.status}). O LinkedIn aposenta esse hash a cada\n` +
      'build do cliente web. Para renovar: abra uma busca de publicacoes logado,\n' +
      'filtre o Network por `voyagerSearchDashClusters` e copie o parametro\n' +
      '`queryId` da requisicao para LINKEDIN_SEARCH_QUERY_ID no .env.'
    );
  }

  return response.status === 200 ? undefined : `Resposta inesperada: ${preview(response.data)}`;
}

/**
 * Quando o LinkedIn invalida a sessao ele nao responde 401: devolve 302 para a
 * propria URL e um `set-cookie` que expira o `li_at`. Sem ler isso, o sintoma
 * seria um redirecionamento em loop sem explicacao.
 */
function isSessionRevoked(response: AxiosResponse<unknown>): boolean {
  const cookies = response.headers['set-cookie'] ?? [];

  return (Array.isArray(cookies) ? cookies : [String(cookies)]).some(
    (cookie) => /^li_at=/i.test(cookie) && /delete me|Max-Age=0/i.test(cookie),
  );
}

/**
 * Le o `included` normalizado sem depender do schema exato: o LinkedIn muda
 * nome de campo com frequencia, mas a urn de activity e o texto do post
 * sempre aparecem no mesmo no.
 */
function extractPosts(body: unknown): PostPreview[] {
  const seen = new Set<string>();
  const posts: PostPreview[] = [];

  for (const node of readIncluded(body)) {
    const postId = readActivityId(node);
    const text = postId && !seen.has(postId) ? readCommentary(node) : '';

    if (!postId || text.length === 0) {
      continue;
    }

    seen.add(postId);
    posts.push(buildPreview(node, postId, text));
  }

  return posts;
}

function buildPreview(node: Record<string, unknown>, postId: string, text: string): PostPreview {
  return {
    author: readActorName(node),
    text,
    publishedAt: decodePostTimestamp(postId),
    url: `https://www.linkedin.com/feed/update/urn:li:activity:${postId}/`,
  };
}

function readIncluded(body: unknown): Record<string, unknown>[] {
  const included = (body as { included?: unknown } | null)?.included;

  return Array.isArray(included) ? (included as Record<string, unknown>[]) : [];
}

const ACTIVITY_URN = /urn:li:activity:(\d{15,25})/;

function readActivityId(node: Record<string, unknown>): string | undefined {
  return ACTIVITY_URN.exec(JSON.stringify(node))?.[1];
}

/** `commentary.text.text` e o caminho atual; o resto cobre as variacoes. */
function readCommentary(node: Record<string, unknown>): string {
  return readFirstText(node, [
    ['commentary', 'text', 'text'],
    ['commentary', 'text'],
    ['summary', 'text'],
  ]);
}

function readActorName(node: Record<string, unknown>): string {
  const name = readFirstText(node, [
    ['actor', 'name', 'text'],
    ['actor', 'name'],
    ['title', 'text'],
  ]);

  return name.length > 0 ? name : '(autor desconhecido)';
}

function readFirstText(node: Record<string, unknown>, paths: readonly string[][]): string {
  for (const path of paths) {
    const value = readPath(node, path);

    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return '';
}

function readPath(node: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>(
    (current, key) =>
      typeof current === 'object' && current !== null
        ? (current as Record<string, unknown>)[key]
        : undefined,
    node,
  );
}

function reportPosts(posts: readonly PostPreview[]): void {
  if (posts.length === 0) {
    console.log('\nA resposta veio 200, mas nenhuma publicacao foi reconhecida.');
    console.log('Costuma ser schema novo no `included` ou queryId de outra busca.');

    return;
  }

  console.log(`\n${posts.length} publicacao(oes) na resposta. Primeiras ${PREVIEW_LIMIT}:\n`);

  posts.slice(0, PREVIEW_LIMIT).forEach(printPost);
}

function printPost(post: PostPreview, index: number): void {
  console.log(`${'='.repeat(78)}\n[${index + 1}] ${post.author}`);
  console.log(`    data : ${post.publishedAt?.toISOString() ?? '(nao decodificada)'}`);
  console.log(`    link : ${post.url}`);
  console.log(`    texto: ${truncate(post.text, TEXT_PREVIEW_LENGTH)}\n`);
}

function truncate(value: string, max: number): string {
  const flat = value.replace(/\s+/g, ' ').trim();

  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

function preview(data: unknown): string {
  return truncate(typeof data === 'string' ? data : JSON.stringify(data ?? ''), 300);
}

main().catch((error: unknown) => {
  console.error(`\nFalhou: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
