import { readFile } from 'node:fs/promises';

import { check } from 'proper-lockfile';

import { HARVEST_FILE } from '@/config';
import {
  HARVEST_STATUSES,
  type HarvestFile,
  type HarvestSearchReport,
  type RawPost,
} from '@/contract';

/** Os quatro desfechos possiveis de uma tentativa de leitura. */
export const HARVEST_OUTCOMES = ['read', 'missing', 'unreadable', 'busy'] as const;

export type HarvestOutcome = (typeof HARVEST_OUTCOMES)[number];

/**
 * Resultado de ler a colheita, como uniao discriminada.
 *
 * Quatro desfechos e nao dois porque cada um merece resposta diferente no
 * `GET /posts`: colheita vazia nao e colheita ilegivel, e nenhuma das duas e
 * "esta sendo gravada agora". Achatar isso em `HarvestFile | undefined`
 * obrigaria a rota a adivinhar.
 */
export type HarvestRead =
  | { readonly outcome: 'read'; readonly harvest: HarvestFile }
  | { readonly outcome: 'missing' }
  | { readonly outcome: 'unreadable'; readonly reason: string }
  | { readonly outcome: 'busy' };

/**
 * Onde mora a trava da colheita: ao lado do arquivo, com `.lock` no fim.
 *
 * E o padrao do `proper-lockfile`, mas declarado aqui de proposito. Leitor e
 * escritor precisam apontar para o MESMO caminho, e um default implicito nos
 * dois lados e o tipo de acordo que se quebra em silencio quando um deles
 * passa `realpath` diferente.
 *
 * Nao e a mesma trava do `LOCK_FILE` da config: aquela garante instancia unica
 * do navegador; esta protege um arquivo durante a gravacao.
 */
export function harvestLockPath(file: string): string {
  return `${file}.lock`;
}

interface HarvestReadDeps {
  /** Injetavel para o teste; em producao e a verificacao do `proper-lockfile`. */
  readonly isLocked: (file: string) => Promise<boolean>;
}

/**
 * Le a colheita sem nunca esperar pela gravacao.
 *
 * A trava e consultada, nunca adquirida. Quem chama aqui e uma requisicao HTTP
 * da API, e esperar o navegador terminar de escrever penduraria a captura
 * inteira; a resposta certa e desistir e perguntar de novo no proximo ciclo.
 *
 * A trava, porem, e so a precaucao barata: a garantia de verdade e a gravacao
 * atomica (arquivo temporario + `rename`), que faz o leitor ver a colheita
 * antiga inteira ou a nova inteira, nunca metade de cada.
 */
export async function readHarvestFile(
  file: string,
  deps: HarvestReadDeps = { isLocked: isLockedForWriting },
): Promise<HarvestRead> {
  if (await isBusy(file, deps.isLocked)) {
    return { outcome: 'busy' };
  }

  const content = await readIfExists(file);

  if (content === undefined) {
    return { outcome: 'missing' };
  }

  return parseHarvest(content);
}

/** A colheita do volume configurado: o que o `GET /posts` serve em producao. */
export function readConfiguredHarvest(): Promise<HarvestRead> {
  return readHarvestFile(HARVEST_FILE);
}

/**
 * Falha ao verificar a trava vale como "nao travado".
 *
 * Perder a precaucao nao pode valer mais que servir a colheita: o pior caso e
 * ler durante uma gravacao, e para isso existe o `rename` atomico. A tolerancia
 * mora aqui, e nao dentro da verificacao, porque ela e do leitor — vale para
 * qualquer forma de perguntar se o arquivo esta travado.
 */
async function isBusy(file: string, isLocked: (file: string) => Promise<boolean>): Promise<boolean> {
  try {
    return await isLocked(file);
  } catch {
    return false;
  }
}

function isLockedForWriting(file: string): Promise<boolean> {
  return check(file, { lockfilePath: harvestLockPath(file), realpath: false });
}

async function readIfExists(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return undefined;
  }
}

function parseHarvest(content: string): HarvestRead {
  try {
    const harvest = asHarvest(JSON.parse(content));

    return harvest === undefined
      ? { outcome: 'unreadable', reason: 'o conteudo nao e uma colheita' }
      : { outcome: 'read', harvest };
  } catch (error: unknown) {
    // `String` e nao `error.message`: aqui so cai `SyntaxError` do `JSON.parse`,
    // e um `instanceof` seria um ramo que nenhum teste consegue alcancar.
    return { outcome: 'unreadable', reason: String(error) };
  }
}

/**
 * Validacao rasa, e de proposito.
 *
 * O que se checa aqui e "isto e uma colheita?", nao "cada post esta correto?".
 * Quem escreveu o arquivo foi este mesmo worker, entao a corrupcao provavel e
 * truncamento, nao campo torto; e cada publicacao e validada de novo do outro
 * lado, pelo provider da API, que nao confia em versao nenhuma deste worker.
 */
function asHarvest(value: unknown): HarvestFile | undefined {
  const record = asRecord(value);
  const status = HARVEST_STATUSES.find((candidate) => candidate === record?.status);

  if (record === undefined || status === undefined || !hasHarvestLists(record)) {
    return undefined;
  }

  const harvestedAt = readHarvestedAt(record.harvestedAt);

  if (harvestedAt === undefined) {
    return undefined;
  }

  return {
    harvestedAt,
    status,
    // Conteudo das listas nao conferido: ver o comentario acima.
    searches: record.searches as readonly HarvestSearchReport[],
    posts: record.posts as readonly RawPost[],
  };
}

type HarvestLists = Record<string, unknown> & {
  readonly posts: readonly unknown[];
  readonly searches: readonly unknown[];
};

function hasHarvestLists(record: Record<string, unknown>): record is HarvestLists {
  return Array.isArray(record.posts) && Array.isArray(record.searches);
}

/** `undefined` e recusa; `null` e a colheita que nunca aconteceu. */
function readHarvestedAt(value: unknown): string | null | undefined {
  if (value === null || typeof value === 'string') {
    return value;
  }

  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}
