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
  { label: 'Grupo de vagas', aliases: ['grupo de vagas', 'grupo do whatsapp', 'grupo do telegram'] },
  { label: 'Lista de vagas', aliases: ['lista de vagas'] },
  { label: '#opentowork', aliases: ['#opentowork'] },
  { label: 'Open to work', aliases: ['open to work'] },
  { label: 'Meu curriculo', aliases: ['meu curriculo', 'divulgo meu curriculo'] },
  {
    label: 'Busco oportunidade',
    aliases: ['busco oportunidade', 'buscando oportunidade', 'procuro oportunidade'],
  },
  { label: 'Recolocacao', aliases: ['recolocacao'] },
];
