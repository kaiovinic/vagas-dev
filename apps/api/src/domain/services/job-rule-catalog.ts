import type { KeywordGroup } from '@/domain/value-objects/text-normalizer';

export const REMOTE_LOCATION_LABEL = 'Remoto';

/** Stack aceita para Frontend/Fullstack. O rotulo e publico; os aliases sao o que a captura reconhece. */
export const STACK_KEYWORDS: readonly KeywordGroup[] = [
  { label: 'React', aliases: ['react', 'reactjs'] },
  { label: 'Next.js', aliases: ['next.js'] },
  { label: 'TypeScript', aliases: ['typescript', 'type-script'] },
  { label: 'Node.js', aliases: ['node.js', 'node'] },
  { label: 'Angular', aliases: ['angular', 'angularjs'] },
  { label: 'C#', aliases: ['c#', 'csharp', 'c-sharp'] },
  { label: '.NET', aliases: ['.net', 'dotnet', 'net-core'] },
  { label: 'Frontend', aliases: ['front-end'] },
  { label: 'Fullstack', aliases: ['full-stack'] },
  /**
   * Cargo de desenvolvimento web sem framework no titulo. Entrou depois da
   * analise dos descartes: "Desenvolvedor Web" em Salvador era reprovado por
   * stack, embora seja exatamente o perfil que o radar procura. Note que o
   * termo e o cargo inteiro, nao a palavra "web" solta.
   */
  {
    label: 'Desenvolvimento Web',
    aliases: [
      'desenvolvedor web',
      'desenvolvedora web',
      'desenvolvimento web',
      'web developer',
      'programador web',
      'desenvolvedor(a) web',
    ],
  },
];

/**
 * Trechos que contem o nome de uma cidade aceita, mas se referem a outro lugar.
 * Sao removidos do texto antes do casamento de localidade.
 *
 * "San Salvador" e a capital de El Salvador: uma vaga de la casava com o termo
 * "salvador" e passava pela regra de localidade como se fosse a Bahia.
 */
export const LOCATION_FALSE_POSITIVES: readonly string[] = [
  'san salvador',
  'salvador de bahia',
  'el salvador',
  // "Bahia Blanca" e cidade argentina; sem isto, a UF "bahia" a aprovaria.
  'bahia blanca',
  // Juazeiro do Norte e no Ceara, e o nome contem o municipio baiano Juazeiro.
  'juazeiro do norte',
];

/**
 * Marcadores da UF da Bahia. Sao o que estende o radar aos 417 municipios do
 * estado sem enumerar nenhum: a maioria das fontes escreve a localidade como
 * "Cidade - BA", "Cidade/BA" ou "Cidade, Bahia".
 *
 * Casam SO no campo de localidade, e e proposital: "BA" solto em texto livre e
 * abreviacao de Business Analyst, e "Bahia" na descricao costuma ser empresa
 * dizendo que atende o estado, nao que contrata nele. E a mesma restricao que
 * `job-scope.ts` aplica as siglas de estado.
 */
export const BAHIA_STATE_KEYWORDS: readonly KeywordGroup[] = [
  { label: 'Bahia/BA', aliases: ['ba', 'bahia'] },
];

/**
 * Municipios baianos reconhecidos pelo NOME, sem a UF ao lado — o que cobre a
 * vaga cuja localidade vem so como "Feira de Santana" e a citada no meio da
 * descricao ("escritorio em Ilheus").
 *
 * A lista nao tenta ser os 417 municipios: isso e trabalho da UF acima. Ela
 * reune a Regiao Metropolitana de Salvador e os maiores polos do interior, e
 * de proposito deixa de fora nome ambiguo com outro estado (Valenca/RJ,
 * Serrinha/RN), que so entra quando a UF aparece na localidade.
 */
export const LOCATION_KEYWORDS: readonly KeywordGroup[] = [
  {
    label: REMOTE_LOCATION_LABEL,
    aliases: ['remoto', 'remota', 'remote', 'home-office', 'anywhere'],
  },
  { label: 'Salvador/BA', aliases: ['salvador'] },
  { label: 'Lauro de Freitas/BA', aliases: ['lauro de freitas'] },
  { label: 'Camacari/BA', aliases: ['camacari'] },
  { label: 'Simoes Filho/BA', aliases: ['simoes filho'] },
  { label: 'Candeias/BA', aliases: ['candeias'] },
  { label: "Dias d'Avila/BA", aliases: ["dias d'avila"] },
  { label: 'Madre de Deus/BA', aliases: ['madre de deus'] },
  { label: 'Sao Francisco do Conde/BA', aliases: ['sao francisco do conde'] },
  { label: 'Mata de Sao Joao/BA', aliases: ['mata de sao joao'] },
  { label: 'Pojuca/BA', aliases: ['pojuca'] },
  { label: 'Sao Sebastiao do Passe/BA', aliases: ['sao sebastiao do passe'] },
  { label: 'Itaparica/BA', aliases: ['itaparica'] },
  { label: 'Vera Cruz/BA', aliases: ['vera cruz'] },
  // Interior: polos de tecnologia e as maiores cidades fora da RMS.
  { label: 'Feira de Santana/BA', aliases: ['feira de santana'] },
  { label: 'Vitoria da Conquista/BA', aliases: ['vitoria da conquista'] },
  { label: 'Itabuna/BA', aliases: ['itabuna'] },
  { label: 'Ilheus/BA', aliases: ['ilheus'] },
  { label: 'Juazeiro/BA', aliases: ['juazeiro'] },
  { label: 'Alagoinhas/BA', aliases: ['alagoinhas'] },
  { label: 'Barreiras/BA', aliases: ['barreiras'] },
  { label: 'Luis Eduardo Magalhaes/BA', aliases: ['luis eduardo magalhaes'] },
  { label: 'Teixeira de Freitas/BA', aliases: ['teixeira de freitas'] },
  { label: 'Porto Seguro/BA', aliases: ['porto seguro'] },
  { label: 'Jequie/BA', aliases: ['jequie'] },
  { label: 'Paulo Afonso/BA', aliases: ['paulo afonso'] },
  { label: 'Eunapolis/BA', aliases: ['eunapolis'] },
  { label: 'Santo Antonio de Jesus/BA', aliases: ['santo antonio de jesus'] },
  { label: 'Guanambi/BA', aliases: ['guanambi'] },
  { label: 'Jacobina/BA', aliases: ['jacobina'] },
  { label: 'Senhor do Bonfim/BA', aliases: ['senhor do bonfim'] },
  { label: 'Irece/BA', aliases: ['irece'] },
  { label: 'Brumado/BA', aliases: ['brumado'] },
  { label: 'Bom Jesus da Lapa/BA', aliases: ['bom jesus da lapa'] },
  { label: 'Itapetinga/BA', aliases: ['itapetinga'] },
];

/**
 * Termos que indicam que a publicacao NAO e uma vaga real: cursos, bootcamps,
 * listas de grupos, propaganda de curriculo e candidatos em recolocacao.
 */
export const SPAM_KEYWORDS: readonly KeywordGroup[] = [
  {
    label: 'Curso',
    aliases: ['curso de', 'curso online', 'curso gratuito', 'curso completo de', 'nosso curso'],
  },
  { label: 'Bootcamp', aliases: ['bootcamp'] },
  { label: 'Mentoria', aliases: ['mentoria', 'mentorias'] },
  { label: 'Imersao', aliases: ['imersao'] },
  { label: 'Masterclass', aliases: ['masterclass'] },
  { label: 'Trilha de estudos', aliases: ['trilha de estudos'] },
  { label: 'E-book', aliases: ['e-book'] },
  {
    label: 'Inscricoes abertas',
    aliases: ['inscricoes abertas', 'matriculas abertas', 'inscreva-se'],
  },
  {
    label: 'Grupo de vagas',
    aliases: [
      'grupo de vagas',
      'grupo do whatsapp',
      'grupo do telegram',
      'canal do telegram',
      'canal do whatsapp',
      'entre no grupo',
      'entra no grupo',
      'comunidade de vagas',
      'link na bio',
    ],
  },
  { label: 'Lista de vagas', aliases: ['lista de vagas'] },
  { label: '#opentowork', aliases: ['#opentowork'] },
  { label: 'Open to work', aliases: ['open to work'] },
  { label: 'Meu curriculo', aliases: ['meu curriculo', 'divulgo meu curriculo'] },
  {
    label: 'Busco oportunidade',
    aliases: ['busco oportunidade', 'buscando oportunidade', 'procuro oportunidade'],
  },
  {
    label: 'Recolocacao',
    aliases: ['recolocacao', 'em busca de recolocacao', 'disponivel para novas oportunidades'],
  },
];

/**
 * Contas que republicam vaga de terceiros em massa.
 *
 * O bloqueio e pelo NOME de quem publicou, nao pelo texto: o anuncio delas e
 * indistinguivel de um anuncio legitimo — tem "vaga", tem stack, tem
 * "candidate-se". O que as separa e nao serem quem contrata, e as vagas
 * chegarem velhas, ja republicadas de outro lugar.
 *
 * A primeira busca real de publicacoes trouxe nove posts; o unico aprovado
 * era da Netvagas, justamente uma dessas contas.
 */
export const JOB_AGGREGATOR_ACCOUNTS: readonly KeywordGroup[] = [
  {
    label: 'Conta agregadora de vagas',
    aliases: [
      'netvagas',
      'caderno nacional',
      'vagas de ti',
      'vagas remotas',
      'vagas tech',
      'devagas',
      'jobs brasil',
      'empregos br',
      'nerdin',
      'recrutei empregos',
      'home office vagas',
      'divulga vagas',
      'repasso vagas',
    ],
  },
];

/**
 * Marcadores de que o texto ANUNCIA uma vaga, e nao apenas fala sobre vagas.
 *
 * Exigidos so em publicacao de rede social. Um anuncio de portal nao precisa
 * dizer "candidate-se" — o botao de candidatura esta na propria pagina. Ja um
 * post e texto livre: sem um destes, o que sobra e opiniao sobre o mercado,
 * relato de carreira ou divulgacao de conteudo, que citam as mesmas palavras.
 */
export const HIRING_SIGNAL_KEYWORDS: readonly KeywordGroup[] = [
  {
    label: 'Estamos contratando',
    aliases: [
      'estamos contratando',
      'estou contratando',
      'contratando',
      'we are hiring',
      "we're hiring",
      'hiring',
      '#contratando',
      '#vagaaberta',
    ],
  },
  {
    label: 'Vaga aberta',
    aliases: [
      'vaga para',
      'vaga aberta',
      'vagas abertas',
      'nova vaga',
      'oportunidade aberta',
      // "VAGA:" e "VAGA REMOTA:" abrem metade dos anuncios de recrutador no
      // LinkedIn. Note que e sempre o cabecalho, com dois pontos ou com a
      // modalidade junto: "vaga" solta aparece em qualquer texto sobre o tema.
      'vaga:',
      'vagas:',
      'vaga remota',
      'vaga clt',
      'vaga pj',
      '#vaga',
    ],
  },
  {
    label: 'Chamada para candidatura',
    aliases: [
      'candidate-se',
      'candidatem-se',
      'inscreva seu curriculo',
      'envie seu curriculo',
      'mande seu curriculo',
      'envie o cv',
      'apply now',
    ],
  },
  {
    label: 'Procurando pessoa',
    aliases: [
      'estamos buscando',
      'estamos procurando',
      'procuramos',
      'buscamos',
      'estamos em busca de',
      'queremos te conhecer',
    ],
  },
];
