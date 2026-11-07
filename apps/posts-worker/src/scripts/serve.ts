import { HARVEST_FILE, PORT, STATE_FILE } from '@/config';
import { buildServer } from '@/server/server';
import { installShutdown } from '@/server/shutdown';

/**
 * Sobe o servidor que serve a ultima colheita.
 *
 * `0.0.0.0` e preciso: dentro do container, escutar em `localhost` tornaria o
 * worker inalcancavel pela API, que fala com ele pelo nome do servico na rede
 * do compose.
 */
async function main(): Promise<void> {
  const app = buildServer({ logger: true });

  installShutdown(app);

  await app.listen({ port: PORT, host: '0.0.0.0' });

  app.log.info(`colheita em ${HARVEST_FILE}`);
  app.log.info(`sessao esperada em ${STATE_FILE}`);
}

void main().catch((error: unknown) => {
  console.error(`servidor de publicacoes nao subiu: ${String(error)}`);
  process.exit(1);
});
