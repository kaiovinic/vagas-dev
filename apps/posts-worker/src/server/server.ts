import fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';

import { HARVEST_TRIGGER_TOKEN } from '@/config';
import { EMPTY_HARVEST, type HarvestStatus } from '@/contract';
import type { HarvestStart } from '@/harvest/harvest-job';
import {
  readConfiguredHarvest,
  type HarvestOutcome,
  type HarvestRead,
} from '@/server/harvest-store';
import { isConfiguredSessionPresent } from '@/server/session-presence';

/** Quanto a API deve esperar antes de perguntar de novo, em segundos. */
const RETRY_AFTER_IN_SECONDS = 5;

const TOKEN_HEADER = 'x-harvest-token';

export interface ServerDeps {
  readonly readHarvest: () => Promise<HarvestRead>;
  readonly isSessionPresent: () => Promise<boolean>;
  /**
   * Dispara uma colheita e volta na hora. O padrao recusa: um processo que
   * apenas serve o cache nao deve fingir que colhe.
   */
  readonly startHarvest: () => Promise<HarvestStart>;
  /** Segredo exigido no `POST /harvest`. Vazio = protegido so pela rede. */
  readonly triggerToken: string;
  /** Log de requisicao. Desligado no teste, ligado em producao. */
  readonly logger: boolean;
}

/** Como cada desfecho do disparo aparece em HTTP. */
const TRIGGER_RESPONSES: Readonly<
  Record<HarvestStart, { readonly code: number; readonly detail: string }>
> = {
  started: { code: 202, detail: 'colheita iniciada; acompanhe pelo GET /health' },
  'already-running': { code: 409, detail: 'ja ha uma colheita em curso' },
  'no-session': { code: 503, detail: 'sem sessao gravada; refaca o login antes' },
  unavailable: { code: 503, detail: 'este processo nao colhe, apenas serve o cache' },
};

/** Resumo da colheita para o `GET /health`. Numeros, nunca conteudo. */
interface HarvestHealth {
  readonly state: HarvestOutcome;
  readonly harvestedAt: string | null;
  readonly status: HarvestStatus | null;
  readonly posts: number;
  readonly reason?: string;
}

/**
 * O servidor que serve o cache — e que sabe pedir uma colheita, sem esperar por
 * ela.
 *
 * O Chromium roda em segundo plano, no mesmo processo mas fora do caminho da
 * requisicao: nenhuma rota aqui espera o navegador, entao um seletor que trava
 * por trinta segundos nao segura o `GET /posts` da API (RFC 001, secao 4).
 *
 * As dependencias entram por parametro porque e assim que o teste exercita as
 * rotas com `inject()`, sem abrir porta nem tocar o disco.
 */
export function buildServer(deps: Partial<ServerDeps> = {}): FastifyInstance {
  const {
    readHarvest = readConfiguredHarvest,
    isSessionPresent = isConfiguredSessionPresent,
    startHarvest = unavailable,
    triggerToken = HARVEST_TRIGGER_TOKEN,
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

  /**
   * Disparo pontual: util depois de refazer o login, ou para conferir uma
   * mudanca de seletor sem esperar oito horas pelo agendador.
   *
   * 202 e nao 200 de proposito: quando a resposta sai, a colheita acabou de
   * comecar e nao ha nada colhido para contar. O resultado aparece no
   * `GET /health`, e as publicacoes no `GET /posts`.
   */
  app.post('/harvest', async (request, reply) => {
    if (!isAuthorized(request, triggerToken)) {
      return reply.code(401).send({ status: 'unauthorized', detail: 'cabecalho ausente ou errado' });
    }

    const start = await startHarvest();
    const { code, detail } = TRIGGER_RESPONSES[start];

    return reply.code(code).send({ status: start, detail });
  });

  return app;
}

/**
 * Sem segredo configurado, quem protege a rota e a rede.
 *
 * O servico nao publica porta no host em producao e escuta em 127.0.0.1 no
 * compose de desenvolvimento, entao so quem esta na rede interna alcanca o
 * `POST /harvest`. O segredo e a segunda camada para quem quiser: a rota abre um
 * navegador logado na conta, e isso merece mais de uma tranca.
 */
function isAuthorized(request: FastifyRequest, token: string): boolean {
  return token.length === 0 || request.headers[TOKEN_HEADER] === token;
}

function unavailable(): Promise<HarvestStart> {
  return Promise.resolve('unavailable');
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
