import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { lock } from 'proper-lockfile';

import { HARVEST_FILE } from '@/config';
import { EMPTY_HARVEST, type HarvestFile } from '@/contract';
import { harvestLockPath, readHarvestFile } from '@/server/harvest-store';

/**
 * Quanto tempo a escrita espera por uma leitura em curso antes de desistir.
 *
 * Curto de proposito: leitura de arquivo pequeno dura milissegundos, e o que
 * nao pode acontecer e a colheita inteira ficar presa esperando um leitor.
 */
const WRITE_RETRIES = { retries: 5, minTimeout: 50, maxTimeout: 500 } as const;

const TMP_SUFFIX = '.tmp';

/**
 * Grava a colheita de forma atomica: arquivo temporario e `rename`.
 *
 * Os dois passos existem porque o `GET /posts` le o mesmo arquivo a qualquer
 * momento. `writeFile` direto tem um instante em que o JSON esta pela metade, e
 * nesse instante a API leria um documento quebrado e registraria a fonte como
 * ilegivel. O `rename` dentro do mesmo sistema de arquivos e atomico: o leitor
 * ve a colheita velha ou a nova, nunca meia.
 *
 * A trava e a MESMA que o leitor confere (`harvestLockPath`): e por ela que o
 * `GET /posts` responde 503 em vez de ler no meio da gravacao.
 */
export async function writeHarvest(
  harvest: HarvestFile,
  file: string = HARVEST_FILE,
): Promise<void> {
  await mkdir(dirname(file), { recursive: true });

  const release = await lock(file, {
    lockfilePath: harvestLockPath(file),
    realpath: false,
    ...WRITE_RETRIES,
  });

  try {
    const temporary = `${file}${TMP_SUFFIX}`;

    await writeFile(temporary, `${JSON.stringify(harvest, null, 2)}\n`, 'utf8');
    await rename(temporary, file);
  } finally {
    await release();
  }
}

/**
 * A colheita anterior, ou um documento vazio.
 *
 * Qualquer motivo para nao ler — arquivo ausente, JSON corrompido, gravacao em
 * curso — vale o mesmo aqui: nao ha o que preservar, e a colheita comeca do
 * zero. Nao e o mesmo que no `GET /posts`, onde "ocupado" merece 503: ali a
 * resposta vai para a API, aqui ninguem esta perguntando nada.
 */
export async function readPreviousHarvest(
  file: string = HARVEST_FILE,
): Promise<HarvestFile> {
  const read = await readHarvestFile(file);

  return read.outcome === 'read' ? read.harvest : EMPTY_HARVEST;
}
