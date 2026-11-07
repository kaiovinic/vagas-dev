/**
 * Uma colheita, a mao: `npm run harvest -w @devradar/posts-worker`.
 *
 * O caminho normal e o agendador dentro do `serve.ts`, que chama a mesma funcao
 * de hora em hora. Este comando existe para a hora de conferir: depois de
 * refazer o login, ou para ver se um seletor ainda funciona sem esperar o
 * relogio. A trava de instancia unica e o que mantem os dois caminhos em paz.
 *
 * Sai com 0 quando gravou — e tambem quando outra colheita ja estava em curso,
 * que e normal e nao erro — e com 1 so quando nada foi gravado.
 */
import { runConfiguredHarvest } from '@/harvest/playwright/configured-harvest';

void runConfiguredHarvest({
  log: (message) => console.info(message),
  warn: (message) => console.warn(message),
}).catch((error: unknown) => {
  console.error(`A colheita falhou e nada foi gravado: ${String(error)}`);
  process.exit(1);
});
