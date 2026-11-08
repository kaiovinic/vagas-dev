import { describe, expect, it } from 'vitest';

import {
  canonicalPostUrl,
  collapseSpaces,
  findActivityId,
  isEmbeddedLink,
  isJobActionLabel,
  isPromotedLabel,
  isSeekingBadge,
  normalizeHref,
  undup,
} from '@/parser/linkedin-post-card';

describe('findActivityId', () => {
  it.each([
    ['urn:li:activity:7521262024920764416', '7521262024920764416'],
    ['urn:li:share:7521262024920764416', '7521262024920764416'],
    ['urn:li:ugcPost:7521262024920764416', '7521262024920764416'],
  ])('le %s', (input, expected) => {
    expect(findActivityId(input)).toBe(expected);
  });

  /** urn truncada e a que o LinkedIn serve em card ainda nao montado. */
  it.each(['urn:li:activity:', 'urn:li:activity:123', 'nada aqui', ''])(
    'devolve undefined para %s',
    (input) => {
      expect(findActivityId(input)).toBeUndefined();
    },
  );
});

describe('canonicalPostUrl', () => {
  it('monta o link permanente a partir do id', () => {
    expect(canonicalPostUrl('7521262024920764416')).toBe(
      'https://www.linkedin.com/feed/update/urn:li:activity:7521262024920764416/',
    );
  });
});

describe('collapseSpaces', () => {
  it('junta quebra de linha e espaco repetido', () => {
    expect(collapseSpaces('  Estamos\n\n  contratando  ')).toBe('Estamos contratando');
  });
});

describe('undup', () => {
  it('desfaz o texto repetido para leitor de tela', () => {
    expect(undup('PromovidoPromovido')).toBe('Promovido');
  });

  it('nao toca em texto de comprimento impar', () => {
    expect(undup('Promovido')).toBe('Promovido');
  });

  /**
   * O caso que uma heuristica ingenua estragaria: as duas metades tem o mesmo
   * tamanho e nao sao iguais.
   */
  it('nao toca em texto cujas metades diferem', () => {
    expect(undup('Vaga nova')).toBe('Vaga nova');
  });
});

describe('isPromotedLabel', () => {
  it.each(['Promovido', 'Promovida', 'Patrocinado', 'Promoted', 'Sponsored', 'PromovidoPromovido'])(
    'reconhece %s',
    (label) => {
      expect(isPromotedLabel(label)).toBe(true);
    },
  );

  /** Um post que FALA de anuncio pago nao e um anuncio pago. */
  it('nao casa com o rotulo no meio de uma frase', () => {
    expect(isPromotedLabel('Este conteudo foi Promovido por nos')).toBe(false);
  });
});

describe('isSeekingBadge', () => {
  it('reconhece o selo na foto do autor', () => {
    expect(isSeekingBadge('Foto de Carlos Souza, buscando emprego', 'Carlos Souza')).toBe(true);
  });

  /** Selo de outra pessoa no mesmo card (quem reagiu) nao conta. */
  it('ignora o selo de quem nao e o autor', () => {
    expect(isSeekingBadge('Foto de Alguem Mais, buscando emprego', 'Maria Silva')).toBe(false);
  });

  it('ignora foto sem selo', () => {
    expect(isSeekingBadge('Foto de Maria Silva', 'Maria Silva')).toBe(false);
  });
});

describe('normalizeHref', () => {
  it('resolve href relativo e tira a query', () => {
    expect(normalizeHref('/jobs/view/123?src=li')).toBe('https://www.linkedin.com/jobs/view/123');
  });

  it('tira a barra final, para o link repetido virar um so', () => {
    expect(normalizeHref('https://portal.gupy.io/job/1/')).toBe('https://portal.gupy.io/job/1');
  });

  it.each(['javascript:void(0)', 'mailto:vagas@acme.com'])('recusa %s', (href) => {
    expect(normalizeHref(href)).toBe('');
  });

  it('recusa URL malformada sem explodir', () => {
    expect(normalizeHref('http://')).toBe('');
  });
});

describe('isEmbeddedLink', () => {
  it.each([
    'https://portal.gupy.io/job/1234',
    'https://lnkd.in/dAbCdEf',
    'https://www.linkedin.com/jobs/view/4482768114',
  ])('mantem %s', (url) => {
    expect(isEmbeddedLink(url)).toBe(true);
  });

  it.each([
    'https://www.linkedin.com/in/maria-silva',
    'https://www.linkedin.com/company/acme',
    'https://www.linkedin.com/feed/update/urn:li:activity:7521262024920764416',
    'https://www.linkedin.com/school/ufba',
  ])('descarta a mobilia do LinkedIn em %s', (url) => {
    expect(isEmbeddedLink(url)).toBe(false);
  });

  it('descarta a raiz do LinkedIn', () => {
    expect(isEmbeddedLink('https://www.linkedin.com')).toBe(false);
  });

  it('descarta href que nao normalizou', () => {
    expect(isEmbeddedLink('')).toBe(false);
  });
});

describe('isJobActionLabel', () => {
  it.each(['Candidate-se', 'Aplicar agora', 'Apply now', 'Inscreva-se', 'Ver vaga', 'Vagas'])(
    'reconhece %s',
    (label) => {
      expect(isJobActionLabel(label)).toBe(true);
    },
  );

  it.each(['Maria Silva', 'portal.gupy.io', 'Ver no LinkedIn'])('ignora %s', (label) => {
    expect(isJobActionLabel(label)).toBe(false);
  });
});
