import type { FastifyBaseLogger } from 'fastify';

import {
  HARVEST_FILE,
  HARVEST_INTERVAL_IN_MS,
  HARVEST_JITTER_IN_MS,
  PORT,
  SHUTDOWN_DRAIN_IN_MS,
  STATE_FILE,
} from '@/config';
import { readPreviousHarvest } from '@/harvest/harvest-file';
import { createScheduledTrigger, readHarvestGate } from '@/harvest/harvest-gate';
import { HarvestJob } from '@/harvest/harvest-job';
import {
  scheduleWithTimeout,
  startHarvestScheduler,
  type HarvestScheduler,
} from '@/harvest/harvest-scheduler';
import { runConfiguredHarvest } from '@/harvest/playwright/configured-harvest';
import { buildServer } from '@/server/server';
import {
  configuredSessionWrittenAt,
  isConfiguredSessionPresent,
} from '@/server/session-presence';
import { installShutdown } from '@/server/shutdown';

/**
 * Sobe o servidor que serve a ultima colheita, com o relogio da colheita dentro.
 *
 * Um processo e nao dois: o Fastify atende a API enquanto o Chromium trabalha em
 * segundo plano, e nenhuma rota espera o navegador. `0.0.0.0` e preciso — dentro
 * do container, escutar em `localhost` tornaria o worker inalcancavel pela API,
 * que fala com ele pelo nome do servico na rede do compose.
 */
async function main(): Promise<void> {
  const job = new HarvestJob({
    harvest: () => runConfiguredHarvest({ log: logInfo, warn: logWarn }),
    isSessionPresent: isConfiguredSessionPresent,
    log: logInfo,
    warn: logWarn,
  });

  const app = buildServer({ logger: true, startHarvest: () => job.start() });
  const scheduler = await schedule(job, app.log);

  installShutdown(app, { drain: () => drain(scheduler, job, app.log) });

  await app.listen({ port: PORT, host: '0.0.0.0' });

  app.log.info(`colheita em ${HARVEST_FILE}`);
  app.log.info(`sessao esperada em ${STATE_FILE}`);
}

/**
 * O agendador comeca sabendo a idade da colheita que ja esta no volume: sem
 * isso, um container que reinicia antes de o intervalo vencer nunca colheria.
 */
async function schedule(job: HarvestJob, log: FastifyBaseLogger): Promise<HarvestScheduler> {
  const previous = await readPreviousHarvest();

  return startHarvestScheduler({
    intervalInMs: HARVEST_INTERVAL_IN_MS,
    jitterInMs: HARVEST_JITTER_IN_MS,
    // Só o agendador passa pela porta; o `POST /harvest` dispara direto, porque
    // quem bate nele sabe mais sobre a conta que qualquer regra nossa.
    trigger: createScheduledTrigger({
      gate: () =>
        readHarvestGate({
          sessionWrittenAt: configuredSessionWrittenAt,
          previous: readPreviousHarvest,
        }),
      start: () => job.start(),
      log: (message) => log.warn(message),
    }),
    lastHarvestedAt: previous.harvestedAt === null ? null : new Date(previous.harvestedAt),
    now: () => new Date(),
    random: Math.random,
    schedule: scheduleWithTimeout,
    log: (message) => log.info(message),
  });
}

/** Primeiro para o relogio, depois espera quem ja esta na estrada. */
async function drain(
  scheduler: HarvestScheduler,
  job: HarvestJob,
  log: FastifyBaseLogger,
): Promise<boolean> {
  scheduler.stop();

  if (job.running) {
    log.info('Esperando a colheita em curso terminar antes de fechar');
  }

  return await job.settle(SHUTDOWN_DRAIN_IN_MS);
}

function logInfo(message: string): void {
  console.info(message);
}

function logWarn(message: string): void {
  console.warn(message);
}

void main().catch((error: unknown) => {
  console.error(`servidor de publicacoes nao subiu: ${String(error)}`);
  process.exit(1);
});
