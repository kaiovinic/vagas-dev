import { describe, expect, it } from 'vitest';

import { EMPTY_HARVEST, HARVEST_STATUSES } from '@/contract';

describe('EMPTY_HARVEST', () => {
  /**
   * Guarda contra a "correcao" tentadora de carimbar `new Date()` aqui. Com uma
   * data, a API acreditaria em uma colheita que nunca houve, e a tabela de
   * saude anunciaria dado fresco de um worker que ainda nao abriu o navegador.
   */
  it('nao finge ter colhido', () => {
    expect(EMPTY_HARVEST.harvestedAt).toBeNull();
    expect(EMPTY_HARVEST.status).toBe('never-ran');
  });

  it('e um documento valido e vazio, nao uma falha', () => {
    expect(EMPTY_HARVEST.posts).toEqual([]);
    expect(EMPTY_HARVEST.searches).toEqual([]);
  });
});

describe('HARVEST_STATUSES', () => {
  it('cobre os quatro estados do contrato', () => {
    expect([...HARVEST_STATUSES]).toEqual(['ok', 'degraded', 'session-lost', 'never-ran']);
  });
});
