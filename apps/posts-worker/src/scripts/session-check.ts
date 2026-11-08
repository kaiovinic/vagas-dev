/**
 * Confere se a sessao gravada ainda abre o feed, sem janela.
 *
 *   npm run session:check --workspace @devradar/posts-worker
 *
 * E o comando que de fato encerra a Fase 1: o login prova que voce entrou, este
 * prova que o `state.json` serve. Rode-o de novo amanha — a pergunta que decide
 * o projeto nao e se a sessao nasce, e se ela dura.
 *
 * Sai com codigo 1 quando a sessao nao vale, para servir de porta em script.
 */
import { existsSync } from 'node:fs';

import { STATE_FILE } from '@/config';
import { checkSession } from '@/session/linkedin-session';

async function main(): Promise<void> {
  if (!existsSync(STATE_FILE)) {
    console.error(`Sem sessao em ${STATE_FILE}`);
    console.error('Rode primeiro: npm run session:login --workspace @devradar/posts-worker');
    process.exit(1);
  }

  console.log(`Conferindo a sessao de ${STATE_FILE}...`);

  const { valid, url } = await checkSession(STATE_FILE);

  if (!valid) {
    console.error(`\nSessao NAO vale. O navegador parou em: ${url}`);
    console.error('Rode o session:login de novo para renovar.');
    process.exit(1);
  }

  console.log(`\nSessao valida. Feed aberto em: ${url}`);
}

main().catch((error: unknown) => {
  console.error(`\nFalhou: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
