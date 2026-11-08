/**
 * Primeiro login do LinkedIn, com janela aberta.
 *
 *   npm run session:login --workspace @devradar/posts-worker
 *
 * Abre um Chromium visivel na sua maquina. Voce digita e-mail e senha da conta
 * do DevRadar e resolve a verificacao, se ela vier; o script espera, detecta o
 * feed e grava a sessao em `data/state.json`.
 *
 * Nenhuma credencial passa por aqui: o script nao le senha de variavel de
 * ambiente nem a digita por voce. Ele so observa a URL ate o feed aparecer.
 *
 * Em producao este mesmo comando roda dentro do container, sob Xvfb, com a
 * janela alcancada por noVNC em tunel SSH (RFC 001, secao 6.1) — porque a
 * sessao tem de nascer no Linux que vai usa-la.
 */
import { STATE_FILE } from '@/config';
import { createSession } from '@/session/linkedin-session';

/** Tempo para digitar o login e atravessar a 2FA, sem pressa. */
const WAIT_FOR_LOGIN_MS = 300_000;

async function main(): Promise<void> {
  console.log('Abrindo o navegador para o login do LinkedIn.');
  console.log(`A sessao sera gravada em: ${STATE_FILE}\n`);

  await createSession(STATE_FILE, WAIT_FOR_LOGIN_MS, (message) => console.log(`  ${message}`));

  console.log('\nSessao gravada.');
  console.log('Esse arquivo e credencial: nao comite, nao copie para log.');
  console.log('Confira com: npm run session:check --workspace @devradar/posts-worker');
}

main().catch((error: unknown) => {
  console.error(`\nFalhou: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
