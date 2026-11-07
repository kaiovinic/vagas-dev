import fastify, { type FastifyInstance } from 'fastify';

import { EMPTY_HARVEST, type HarvestStatus } from '@/contract';
import {
  readConfiguredHarvest,
  type HarvestOutcome,
  type HarvestRead,
} from '@/server/harvest-store';
import { isConfiguredSessionPresent } from '@/server/session-presence';

/** Quanto a API deve esperar antes de perguntar de novo, em segundos. */
const RETRY_AFTER_IN_SECONDS = 5;

export interface ServerDeps {
  readonly readHarvest: () => Promise<HarvestRead>;
  readonly isSessionPresent: () => Promise<boolean>;
  /** Log de requisicao. Desligado no teste, ligado em producao. */
  readonly logger: boolean;
}

/** Resumo da colheita para o `GET /health`. Numeros, nunca conteudo. */
interface HarvestHealth {
  readonly state: HarvestOutcome;
  readonly harvestedAt: string | null;
  readonly status: HarvestStatus | null;
  readonly posts: number;
  readonly reason?: string;
}

/**
 * O servidor que serve o cache, e so isso.
 *
 * Nao colhe, nao abre navegador, nao decide cadencia: quem faz isso e o cron do
 * worker, em outro processo do mesmo container. Esta separacao e o que garante
 * que um Chromium preso em espera de seletor nao possa segurar a captura da API
 * (RFC 001, secao 4).
 *
 * As dependencias entram por parametro porque e assim que o teste exercita as
 * rotas com `inject()`, sem abrir porta nem tocar o disco.
 */
export function buildServer(deps: Partial<ServerDeps> = {}): FastifyInstance {
  const {
    readHarvest = readConfiguredHarvest,
    isSessionPresent = isConfiguredSessionPresent,
    logger = false,
  } = deps;

  const app = fastify({ logger });

  app.get('/posts', async (_request, reply) => {
    const read = await readHarvest();

    if (read.outcome === 'busy') {
      return reply
        .code(503)
        .header('Retry-After', String(RETRY_AFTER_IN_SECONDS))
        .send({ status: 'busy', detail: 'colheita em gravacao; tente de novo' });
    }

    return reply.send(read.outcome === 'read' ? read.harvest : EMPTY_HARVEST);
  });

  app.get('/health', async (_request, reply) => {
    const [read, sessionPresent] = await Promise.all([readHarvest(), isSessionPresent()]);
    const harvest = describeHarvest(read);

    return reply.send({
      status: isHealthy(harvest, sessionPresent) ? 'ok' : 'degraded',
      uptimeInSeconds: Math.round(process.uptime()),
      harvest,
      session: { present: sessionPresent },
    });
  });

  return app;
}

/**
 * Degradado, nunca reprovado.
 *
 * O healthcheck do Docker reinicia o container quando esta rota falha, e nenhum
 * restart traz de volta uma sessao perdida nem conserta um JSON truncado — so
 * trocaria um problema visivel por um loop de restart. Entao o estado vai no
 * corpo, para quem le; o codigo HTTP responde apenas se o servidor esta de pe.
 */
function isHealthy(harvest: HarvestHealth, sessionPresent: boolean): boolean {
  return harvest.state !== 'unreadable' && sessionPresent;
}

/** Colheita ausente nao e falha: e um worker que ainda nao rodou o cron. */
function describeHarvest(read: HarvestRead): HarvestHealth {
  if (read.outcome === 'read') {
    return {
      state: 'read',
      harvestedAt: read.harvest.harvestedAt,
      status: read.harvest.status,
      posts: read.harvest.posts.length,
    };
  }

  const empty = { state: read.outcome, harvestedAt: null, status: null, posts: 0 } as const;

  return read.outcome === 'unreadable' ? { ...empty, reason: read.reason } : empty;
}
