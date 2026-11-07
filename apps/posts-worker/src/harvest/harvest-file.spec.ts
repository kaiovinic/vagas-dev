import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { check, lock } from 'proper-lockfile';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EMPTY_HARVEST, type HarvestFile } from '@/contract';
import { readPreviousHarvest, writeHarvest } from '@/harvest/harvest-file';
import { harvestLockPath, readHarvestFile } from '@/server/harvest-store';

const HARVEST: HarvestFile = {
  harvestedAt: '2026-11-07T12:00:00.000Z',
  status: 'ok',
  searches: [
    {
      label: 'Bahia',
      query: 'vaga desenvolvedor Salvador Bahia',
      found: 1,
      discarded: {
        promoted: 0,
        openToWork: 1,
        unaddressable: 0,
        withoutContent: 0,
        withoutUrl: 0,
      },
    },
  ],
  posts: [
    {
      url: 'https://www.linkedin.com/feed/update/urn:li:activity:7521262024920764416/',
      author: 'Maria Silva',
      text: 'Estamos contratando pessoa desenvolvedora React em Salvador.',
      links: ['https://portal.gupy.io/job/1234'],
      hasJobAction: true,
    },
  ],
};

describe('writeHarvest', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'devradar-write-'));
    file = join(dir, 'harvest.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('grava a colheita de um jeito que o leitor entende', async () => {
    await writeHarvest(HARVEST, file);

    await expect(readHarvestFile(file)).resolves.toEqual({
      outcome: 'read',
      harvest: HARVEST,
    });
  });

  it('cria a pasta de dados quando ela ainda nao existe', async () => {
    const nested = join(dir, 'data', 'harvest.json');

    await writeHarvest(HARVEST, nested);

    await expect(readFile(nested, 'utf8')).resolves.toContain('Maria Silva');
  });

  it('substitui a colheita anterior inteira, e nao mistura as duas', async () => {
    await writeFile(file, JSON.stringify({ ...HARVEST, status: 'degraded' }), 'utf8');

    await writeHarvest({ ...HARVEST, posts: [] }, file);

    const written = JSON.parse(await readFile(file, 'utf8')) as HarvestFile;

    expect(written.posts).toEqual([]);
    expect(written.status).toBe('ok');
  });

  /** O `.tmp` que fica para tras seria lido por ninguem e cresceria sozinho. */
  it('nao deixa arquivo temporario para tras', async () => {
    await writeHarvest(HARVEST, file);

    await expect(readdir(dir)).resolves.toEqual(['harvest.json']);
  });

  it('solta a trava no fim, inclusive para o leitor', async () => {
    await writeHarvest(HARVEST, file);

    await expect(
      check(file, { lockfilePath: harvestLockPath(file), realpath: false }),
    ).resolves.toBe(false);
  });

  it('solta a trava tambem quando a gravacao falha', async () => {
    // Pasta onde o arquivo deveria estar: o `rename` nao tem como vencer.
    await mkdir(file, { recursive: true });

    await expect(writeHarvest(HARVEST, file)).rejects.toThrow();
    await expect(
      check(file, { lockfilePath: harvestLockPath(file), realpath: false }),
    ).resolves.toBe(false);
  });

  it('espera a leitura em curso em vez de gravar por cima dela', async () => {
    const release = await lock(file, {
      lockfilePath: harvestLockPath(file),
      realpath: false,
    });

    const writing = writeHarvest(HARVEST, file);

    await release();
    await writing;

    await expect(readFile(file, 'utf8')).resolves.toContain('Maria Silva');
  });
});

describe('readPreviousHarvest', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'devradar-previous-'));
    file = join(dir, 'harvest.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('devolve a colheita gravada, para a proxima preservar o que vale', async () => {
    await writeHarvest(HARVEST, file);

    await expect(readPreviousHarvest(file)).resolves.toEqual(HARVEST);
  });

  it('sem arquivo nenhum comeca do vazio', async () => {
    await expect(readPreviousHarvest(file)).resolves.toEqual(EMPTY_HARVEST);
  });

  /** Aqui, ao contrario do `GET /posts`, ilegivel e ausente valem o mesmo. */
  it('arquivo corrompido tambem comeca do vazio', async () => {
    await writeFile(file, '{ isto nao e json', 'utf8');

    await expect(readPreviousHarvest(file)).resolves.toEqual(EMPTY_HARVEST);
  });
});
