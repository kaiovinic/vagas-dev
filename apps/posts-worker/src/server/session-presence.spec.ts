import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  configuredSessionWrittenAt,
  isConfiguredSessionPresent,
  isSessionFilePresent,
  sessionWrittenAt,
} from '@/server/session-presence';

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

describe('sessionWrittenAt', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'devradar-session-at-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** A data, e nunca o conteudo: e a evidencia de que o login foi refeito. */
  it('devolve quando o arquivo foi escrito', async () => {
    const file = join(dir, 'state.json');
    const before = Date.now() - 1_000;

    await writeFile(file, '{"cookies":[]}', 'utf8');

    const writtenAt = await sessionWrittenAt(file);

    expect(writtenAt?.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('sem arquivo, devolve nulo em vez de explodir', async () => {
    await expect(sessionWrittenAt(join(dir, 'state.json'))).resolves.toBeNull();
  });

  it('responde sobre a sessao configurada haja ou nao arquivo', async () => {
    const writtenAt = await configuredSessionWrittenAt();

    expect(writtenAt === null || writtenAt instanceof Date).toBe(true);
  });
});
