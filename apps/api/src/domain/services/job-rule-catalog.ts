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
];

/** Localidades aceitas: 100% remoto ou Salvador e Regiao Metropolitana (RMS). */
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
    aliases: ['vaga para', 'vaga aberta', 'vagas abertas', 'nova vaga', 'oportunidade aberta'],
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
