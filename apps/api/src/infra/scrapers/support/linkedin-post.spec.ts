import { describe, expect, it } from 'vitest';

import {
  authorDisplayName,
  decodePostTimestamp,
  parsePostUrl,
} from '@/infra/scrapers/support/linkedin-post';

/**
 * URLs reais, capturadas de publicacoes publicas em 29/10/2026. Os instantes
 * esperados sao os que o proprio id devolve — e o unico jeito de provar que a
 * decodificacao funciona sem chamar o LinkedIn.
 */
const POST_MAYARA =
  'https://www.linkedin.com/posts/mayaramoroni_estamos-buscando-uma-desenvolvedora-share-7521262024920764416-91vX/';
const POST_HERBERT =
  'https://www.linkedin.com/posts/herbert-durante-perazzelli-539b0b100_vaga-desenvolvedora-php-100-remoto-share-7521249835149062144-WURs/';

describe('decodePostTimestamp', () => {
  it.each([
    ['7521262024920764416', '2026-10-28T17:30:05.032Z'],
    ['7521249835149062144', '2026-10-28T16:41:38.764Z'],
  ])('decodifica o id %s', (postId, esperado) => {
    expect(decodePostTimestamp(postId)?.toISOString()).toBe(esperado);
  });

  it('da precisao de minutos, o que o resultado de buscador nao traz', () => {
    const published = decodePostTimestamp('7521262024920764416');

    expect(published?.getUTCHours()).toBe(17);
    expect(published?.getUTCMinutes()).toBe(30);
  });

  it('preserva a ordem entre duas publicacoes', () => {
    const antes = decodePostTimestamp('7521249835149062144');
    const depois = decodePostTimestamp('7521262024920764416');

    expect(depois!.getTime()).toBeGreaterThan(antes!.getTime());
  });

  it.each([
    ['vazio', ''],
    ['com letras', '75212620249a0764416'],
    ['curto demais', '12345'],
    ['com sinal', '-7521262024920764416'],
  ])('rejeita id %s', (_caso, postId) => {
    expect(decodePostTimestamp(postId)).toBeUndefined();
  });

  it('rejeita id que decodifica para antes da epoca', () => {
    expect(decodePostTimestamp('000000000000000')).toBeUndefined();
  });
});

describe('parsePostUrl', () => {
  it('extrai autor, id e data de uma publicacao real', () => {
    const post = parsePostUrl(POST_MAYARA);

    expect(post).toMatchObject({
      author: 'mayaramoroni',
      postId: '7521262024920764416',
      url: 'https://www.linkedin.com/posts/mayaramoroni_estamos-buscando-uma-desenvolvedora-share-7521262024920764416-91vX',
    });
    expect(post?.publishedAt.toISOString()).toBe('2026-10-28T17:30:05.032Z');
  });

  it('aguenta slug com hifen e sufixo', () => {
    expect(parsePostUrl(POST_HERBERT)?.author).toBe('herbert-durante-perazzelli-539b0b100');
  });

  it('descarta a query de rastreamento do link', () => {
    const comRastreio = `${POST_MAYARA}?utm_source=share&utm_medium=member_desktop`;

    expect(parsePostUrl(comRastreio)?.url).not.toContain('utm_source');
  });

  it.each([
    ['activity', 'https://www.linkedin.com/posts/acme_vaga-react-activity-7521262024920764416-91vX'],
    ['ugcPost', 'https://www.linkedin.com/posts/acme_vaga-react-ugcPost-7521262024920764416-91vX'],
  ])('reconhece o formato %s', (_caso, url) => {
    expect(parsePostUrl(url)?.postId).toBe('7521262024920764416');
  });

  it.each([
    ['perfil', 'https://www.linkedin.com/in/mayaramoroni'],
    ['vaga, nao publicacao', 'https://www.linkedin.com/jobs/view/4482559692/'],
    ['pagina de empresa', 'https://www.linkedin.com/company/acme'],
    ['texto solto', 'nao e uma url'],
  ])('ignora %s, que o buscador mistura nos resultados', (_caso, url) => {
    expect(parsePostUrl(url)).toBeUndefined();
  });

  it('ignora o formato de feed, que nao identifica o autor', () => {
    // `/feed/update/urn:li:activity:<id>` da o id mas nao o slug de quem
    // publicou, e sem autor nao ha empresa para o fingerprint.
    const feed = 'https://www.linkedin.com/feed/update/urn:li:activity:7521262024920764416';

    expect(parsePostUrl(feed)).toBeUndefined();
  });

  it('ignora publicacao cujo id nao decodifica', () => {
    const invalido = 'https://www.linkedin.com/posts/acme_vaga-share-000000000000000-91vX';

    expect(parsePostUrl(invalido)).toBeUndefined();
  });
});

describe('authorDisplayName', () => {
  it.each([
    ['mayaramoroni', 'Mayaramoroni'],
    ['maria-silva', 'Maria Silva'],
    ['herbert-durante-perazzelli-539b0b100', 'Herbert Durante Perazzelli'],
  ])('transforma o slug %s em "%s"', (slug, esperado) => {
    expect(authorDisplayName(slug)).toBe(esperado);
  });

  it('nao quebra com slug vazio', () => {
    expect(authorDisplayName('')).toBe('');
  });
});
