import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { lock } from 'proper-lockfile';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  HARVEST_OUTCOMES,
  harvestLockPath,
  readConfiguredHarvest,
  readHarvestFile,
} from '@/server/harvest-store';

const HARVEST = {
  harvestedAt: '2026-11-05T09:12:44.000Z',
  status: 'ok',
  searches: [],
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

describe('readHarvestFile', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'devradar-harvest-'));
    file = join(dir, 'harvest.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('le a colheita gravada no disco', async () => {
    await writeFile(file, JSON.stringify(HARVEST), 'utf8');

    const read = await readHarvestFile(file);

    expect(read.outcome).toBe('read');
    expect(read.outcome === 'read' && read.harvest.posts).toHaveLength(1);
  });

  it('nao transforma nada: devolve o documento como esta no disco', async () => {
    await writeFile(file, JSON.stringify(HARVEST), 'utf8');

    const read = await readHarvestFile(file);

    expect(read.outcome === 'read' && read.harvest).toEqual(HARVEST);
  });

  /** Antes da primeira colheita o arquivo simplesmente nao existe. */
  it('diz que o arquivo nao existe, em vez de falhar', async () => {
    expect((await readHarvestFile(file)).outcome).toBe('missing');
  });

  it('trata JSON truncado como ilegivel, com o motivo', async () => {
    await writeFile(file, '{"status": "ok", "posts": [', 'utf8');

    const read = await readHarvestFile(file);

    expect(read.outcome).toBe('unreadable');
    expect(read.outcome === 'unreadable' && read.reason.length).toBeGreaterThan(0);
  });

  /**
   * JSON valido que nao e uma colheita e ilegivel do mesmo jeito: servir isso
   * como `HarvestFile` seria passar lixo adiante com cara de contrato.
   */
  it.each([
    ['json que nao e objeto', '"nao sou uma colheita"'],
    ['sem status conhecido', '{"status":"qualquer","searches":[],"posts":[]}'],
    ['posts que nao e lista', '{"status":"ok","searches":[],"posts":{}}'],
    ['searches que nao e lista', '{"status":"ok","searches":null,"posts":[]}'],
    ['harvestedAt que nao e texto nem nulo', '{"harvestedAt":7,"status":"ok","searches":[],"posts":[]}'],
  ])('recusa %s', async (_label, content) => {
    await writeFile(file, content, 'utf8');

    expect((await readHarvestFile(file)).outcome).toBe('unreadable');
  });

  it('aceita harvestedAt nulo, que e o estado de quem nunca colheu', async () => {
    await writeFile(file, '{"harvestedAt":null,"status":"never-ran","searches":[],"posts":[]}', 'utf8');

    expect((await readHarvestFile(file)).outcome).toBe('read');
  });

  describe('arquivo em gravacao', () => {
    /**
     * O ponto da trava: desistir, nao esperar. Quem le e uma requisicao HTTP da
     * API — bloquear aqui seria pendurar a captura inteira no tempo que o
     * navegador leva para terminar de escrever.
     */
    it('desiste quando a colheita esta travada para gravacao', async () => {
      await writeFile(file, JSON.stringify(HARVEST), 'utf8');
      const release = await lock(file, { lockfilePath: harvestLockPath(file), realpath: false });

      try {
        expect((await readHarvestFile(file)).outcome).toBe('busy');
      } finally {
        await release();
      }
    });

    it('volta a ler depois que a gravacao solta a trava', async () => {
      await writeFile(file, JSON.stringify(HARVEST), 'utf8');
      const release = await lock(file, { lockfilePath: harvestLockPath(file), realpath: false });
      await release();

      expect((await readHarvestFile(file)).outcome).toBe('read');
    });

    it('trava do arquivo mora ao lado dele, onde o escritor a procura', () => {
      expect(harvestLockPath('/dados/harvest.json')).toBe('/dados/harvest.json.lock');
    });

    /**
     * Se a propria verificacao da trava falhar, a resposta e seguir para a
     * leitura: a trava e uma precaucao, e perder a precaucao nao pode valer
     * mais que servir a colheita. O `rename` atomico da gravacao e a garantia
     * de verdade; a trava so evita o trabalho perdido.
     */
    it('segue lendo quando a verificacao da trava falha', async () => {
      await writeFile(file, JSON.stringify(HARVEST), 'utf8');

      const read = await readHarvestFile(file, {
        isLocked: () => Promise.reject(new Error('sem permissao')),
      });

      expect(read.outcome).toBe('read');
    });
  });

  /**
   * A colheita do volume de verdade: o estado dela depende da maquina, e e por
   * isso que o teste cobra so o contrato — um dos quatro resultados conhecidos,
   * nunca uma excecao. Se o `GET /posts` puder explodir, e aqui.
   */
  it('le a colheita configurada sem lancar, qualquer que seja o estado dela', async () => {
    const read = await readConfiguredHarvest();

    expect([...HARVEST_OUTCOMES]).toContain(read.outcome);
  });
});
