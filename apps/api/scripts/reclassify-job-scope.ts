/**
 * Recalcula o campo `scope` das vagas ja gravadas.
 *
 *   npm run jobs:reclassify --workspace @devradar/api            (simulacao)
 *   npm run jobs:reclassify --workspace @devradar/api -- --apply
 *
 * O escopo e classificado no momento da captura e gravado em coluna. Toda vez
 * que o classificador muda, as linhas antigas ficam com o valor velho ate
 * serem recapturadas — o que pode nunca acontecer, porque vaga ja persistida
 * entra como duplicada. Este script fecha essa lacuna.
 *
 * Usa `classifyJobScope` do dominio, a mesma funcao da captura: nao existe
 * segunda implementacao da regra para divergir.
 */
import 'reflect-metadata';
import 'dotenv/config';

import { PrismaClient } from '@prisma/client';

import { classifyJobScope, type JobScope } from '@/domain/services/job-scope';

const APPLY_FLAG = '--apply';
const PREVIEW_LIMIT = 25;

async function main(): Promise<void> {
  const apply = process.argv.includes(APPLY_FLAG);
  const prisma = new PrismaClient();

  try {
    const jobs = await prisma.job.findMany({
      select: {
        id: true,
        title: true,
        company: true,
        description: true,
        city: true,
        tags: true,
        scope: true,
      },
    });

    const changes = jobs
      .map((job) => ({
        id: job.id,
        title: job.title,
        company: job.company,
        from: job.scope as JobScope,
        to: classifyJobScope({
          title: job.title,
          company: job.company,
          description: job.description ?? '',
          location: job.city ?? '',
          tags: job.tags,
        }),
      }))
      .filter((change) => change.from !== change.to);

    if (changes.length === 0) {
      console.log(`${jobs.length} vaga(s) conferidas: nenhuma muda de escopo.`);

      return;
    }

    console.log(`${changes.length} de ${jobs.length} vaga(s) mudam de escopo:\n`);

    for (const change of changes.slice(0, PREVIEW_LIMIT)) {
      console.log(
        `  ${change.from.padEnd(13)} -> ${change.to.padEnd(13)} ${cut(change.company, 22)} — ${cut(change.title, 44)}`,
      );
    }

    if (changes.length > PREVIEW_LIMIT) {
      console.log(`  ... e mais ${changes.length - PREVIEW_LIMIT}.`);
    }

    summarize(changes);

    if (!apply) {
      console.log(`\nSimulacao: nada foi gravado. Rode de novo com ${APPLY_FLAG}.`);

      return;
    }

    for (const change of changes) {
      await prisma.job.update({ where: { id: change.id }, data: { scope: change.to } });
    }

    console.log(`\n${changes.length} vaga(s) atualizada(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

interface ScopeChange {
  readonly from: JobScope;
  readonly to: JobScope;
}

function summarize(changes: readonly ScopeChange[]): void {
  const counts = new Map<string, number>();

  for (const change of changes) {
    const key = `${change.from} -> ${change.to}`;

    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  console.log('\nResumo:');

  for (const [transition, total] of [...counts].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${transition.padEnd(30)} ${total}`);
  }
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
