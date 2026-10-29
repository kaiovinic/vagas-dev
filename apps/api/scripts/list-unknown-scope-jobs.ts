/**
 * Lista as vagas cujo mercado o classificador nao conseguiu determinar
 * (`scope = 'UNKNOWN'`), para decidir se vale calibrar os sinais de
 * nacionalidade em vez de descartar.
 *
 *   npm run jobs:list-unknown --workspace @devradar/api
 *
 * So le. Nao altera nada.
 */
import 'reflect-metadata';
import 'dotenv/config';

import { PrismaClient } from '@prisma/client';

const WINDOW_IN_HOURS = 72;

async function main(): Promise<void> {
  const prisma = new PrismaClient();

  try {
    const since = new Date(Date.now() - WINDOW_IN_HOURS * 60 * 60 * 1000);
    const jobs = await prisma.job.findMany({
      where: { scope: 'UNKNOWN', publishedAt: { gte: since } },
      select: {
        source: true,
        company: true,
        title: true,
        city: true,
        isRemote: true,
        tags: true,
      },
      orderBy: [{ source: 'asc' }, { company: 'asc' }],
    });

    if (jobs.length === 0) {
      console.log('Nenhuma vaga com scope = UNKNOWN nas ultimas 72h.');

      return;
    }

    console.log(`${jobs.length} vaga(s) sem mercado identificado nas ultimas 72h:\n`);
    console.log(
      `${'FONTE'.padEnd(13)} ${'EMPRESA'.padEnd(24)} ${'LOCALIDADE (campo bruto)'.padEnd(30)} TITULO`,
    );
    console.log('-'.repeat(120));

    for (const job of jobs) {
      const place = placeOf(job);

      console.log(
        `${job.source.padEnd(13)} ${cut(job.company, 24).padEnd(24)} ${cut(place, 30).padEnd(30)} ${cut(job.title, 46)}`,
      );
    }

    reportSignals(jobs);
  } finally {
    await prisma.$disconnect();
  }
}

interface InspectedJob {
  readonly source: string;
  readonly company: string;
  readonly title: string;
  /** Nulavel no schema: nem toda fonte publica a localidade. */
  readonly city: string | null;
  readonly isRemote: boolean;
  readonly tags: string[];
}

/**
 * Conta sinais de que a vaga e brasileira mesmo sem dizer "Brasil": cargo
 * escrito em portugues, regime de contratacao daqui, texto em ingles. E o que
 * decide se calibrar o classificador resolve ou se o caso e outro.
 */
function reportSignals(jobs: readonly InspectedJob[]): void {
  const portuguese = /\b(desenvolvedor|desenvolvedora|pessoa|analista|engenheiro|engenheira|programador|estagi|vaga|senior|pleno|junior)\b/i;
  const brazilianContract = /\b(clt|pj|pessoa juridica|carteira assinada|hibrido|presencial)\b/i;

  const comCargoPt = jobs.filter((job) => portuguese.test(job.title));
  const comRegime = jobs.filter((job) =>
    brazilianContract.test([job.title, job.city ?? '', ...job.tags].join(' ')),
  );
  const semLocalidade = jobs.filter((job) => (job.city ?? '').trim().length === 0);

  console.log('\nSinais encontrados:');
  console.log(`  titulo em portugues ........ ${comCargoPt.length} de ${jobs.length}`);
  console.log(`  regime brasileiro (CLT/PJ) . ${comRegime.length} de ${jobs.length}`);
  console.log(`  sem localidade preenchida .. ${semLocalidade.length} de ${jobs.length}`);

  const porFonte = new Map<string, number>();

  for (const job of jobs) {
    porFonte.set(job.source, (porFonte.get(job.source) ?? 0) + 1);
  }

  console.log('\nPor fonte:');

  for (const [source, total] of [...porFonte].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${source.padEnd(13)} ${total}`);
  }
}

/** O campo bruto, como veio da fonte — incluindo o caso de nao ter vindo. */
function placeOf(job: InspectedJob): string {
  const city = (job.city ?? '').trim();

  if (city.length > 0) {
    return city;
  }

  return job.isRemote ? '(vazio, isRemote)' : '(vazio)';
}

function cut(value: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').trim();

  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`\nFalhou: ${message}`);
  process.exit(1);
});
