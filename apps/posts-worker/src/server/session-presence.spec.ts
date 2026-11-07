import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isConfiguredSessionPresent, isSessionFilePresent } from '@/server/session-presence';

describe('isSessionFilePresent', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'devradar-session-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** Apenas existencia: o conteudo do arquivo e a credencial da conta. */
  it('reconhece a sessao salva', async () => {
    const file = join(dir, 'state.json');
    await writeFile(file, '{"cookies":[]}', 'utf8');

    expect(await isSessionFilePresent(file)).toBe(true);
  });

  it('diz que nao ha sessao quando o arquivo nao existe', async () => {
    expect(await isSessionFilePresent(join(dir, 'state.json'))).toBe(false);
  });

  it('responde sobre a sessao configurada sem explodir, haja ou nao', async () => {
    expect(typeof (await isConfiguredSessionPresent())).toBe('boolean');
  });
});
