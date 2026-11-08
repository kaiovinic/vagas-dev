import { describe, expect, it } from 'vitest';

import { isChallenge, isSignedIn } from '@/session/linkedin-urls';

describe('isSignedIn', () => {
  it('aceita o feed', () => {
    expect(isSignedIn('https://www.linkedin.com/feed/')).toBe(true);
  });

  it.each([
    'https://www.linkedin.com/login',
    'https://www.linkedin.com/uas/login-submit',
    'https://www.linkedin.com/checkpoint/challenge/verify',
    'https://www.linkedin.com/authwall?trk=ht',
  ])('recusa %s', (url) => {
    expect(isSignedIn(url)).toBe(false);
  });

  /**
   * A guarda que importa: sem o `startsWith`, um desvio para fora do dominio
   * passaria por sessao valida so por nao casar com nenhum caminho da lista.
   */
  it('recusa URL de outro dominio', () => {
    expect(isSignedIn('https://exemplo.com/feed/')).toBe(false);
  });
});

describe('isChallenge', () => {
  it('reconhece checkpoint e challenge', () => {
    expect(isChallenge('https://www.linkedin.com/checkpoint/rm/verify')).toBe(true);
    expect(isChallenge('https://www.linkedin.com/challenge/')).toBe(true);
  });

  it('nao confunde o feed com desafio', () => {
    expect(isChallenge('https://www.linkedin.com/feed/')).toBe(false);
  });
});
