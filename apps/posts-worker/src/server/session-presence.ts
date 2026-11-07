import { access } from 'node:fs/promises';

import { STATE_FILE } from '@/config';

/**
 * Se ha sessao salva no volume — e NADA sobre o conteudo dela.
 *
 * O `state.json` e a credencial da conta: quem o le entra no LinkedIn como o
 * DevRadar. O `GET /health` precisa saber se ele existe, porque sem sessao o
 * worker nao tem como colher; nao precisa, e nao deve, saber mais que isso.
 */
export async function isSessionFilePresent(file: string): Promise<boolean> {
  try {
    await access(file);

    return true;
  } catch {
    return false;
  }
}

/** A sessao do volume configurado, como o `GET /health` a consulta. */
export function isConfiguredSessionPresent(): Promise<boolean> {
  return isSessionFilePresent(STATE_FILE);
}
