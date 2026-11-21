import { normalizeForMatching } from '@/domain/value-objects/text-normalizer';

/**
 * Cargos que valem uma requisicao de detalhe.
 *
 * Isto NAO e filtro de dominio, e a busca que falta. Duas fontes do radar —
 * InHire e BNE — tem a data de publicacao SO na pagina de detalhe, e nenhuma
 * das duas deixa pesquisar por stack: a InHire devolve o quadro inteiro da
 * empresa (comercial, logistica, juridico) e o BNE devolve a funcao inteira,
 * com cada anuncio que algum dia foi publicado nela. Sem recorte, cada ciclo
 * pediria centenas de detalhes para achar as poucas vagas de desenvolvimento.
 *
 * Por isso a lista e deliberadamente mais larga que a regra de stack: ela diz
 * apenas "isto e um cargo de desenvolvimento", e nao se a vaga serve. Quem
 * decide continua sendo o `JobRuleEngine`, que recebe o anuncio completo —
 * inclusive o backend Java e o ADVPL que entram aqui e sao descartados la.
 */
export const DEVELOPER_ROLE_HINTS: readonly string[] = [
  'desenvolvedor',
  'desenvolvedora',
  'developer',
  'programador',
  'programadora',
  'engenheiro de software',
  'engenheira de software',
  'software engineer',
  'frontend',
  'front-end',
  'front end',
  'fullstack',
  'full stack',
  'full-stack',
  'react',
  'angular',
  'node',
  '.net',
  'dotnet',
  'typescript',
];

export function looksLikeDeveloperRole(title: string): boolean {
  const normalized = normalizeForMatching(title);

  return DEVELOPER_ROLE_HINTS.some((hint) => normalized.includes(hint));
}
