/**
 * Remove do banco as vagas com `scope = 'INTERNATIONAL'` capturadas antes de o
 * motor de regras passar a rejeitar mercado internacional.
 *
 *   npm run jobs:purge-international --workspace @devradar/api          (simulacao)
 *   npm run jobs:purge-international --workspace @devradar/api -- --apply
 *
 * Sem `--apply` o script nao escreve nada: lista o que sairia e encerra. A
 * exclusao e definitiva e o `JobCaptureLog` nao guarda o conteudo das vagas,
 * entao conferir antes e a unica forma de voltar atras.
 */
import 'reflect-metadata';
import 'dotenv/config';

import { PrismaClient } from '@prisma/client';

const APPLY_FLAG = '--apply';
const PREVIEW_LIMIT = 20;

async function main(): Promise<void> {
  const apply = process.argv.includes(APPLY_FLAG);
  const prisma = new PrismaClient();

  try {
    const targets = await prisma.job.findMany({
      where: { scope: 'INTERNATIONAL' },
      select: { id: true, title: true, company: true, source: true, publishedAt: true },
      orderBy: { publishedAt: 'desc' },
    });

    if (targets.length === 0) {
      console.log('Nenhuma vaga com scope = INTERNATIONAL no banco.');

      return;
    }

    console.log(`${targets.length} vaga(s) com scope = INTERNATIONAL:\n`);

    for (const job of targets.slice(0, PREVIEW_LIMIT)) {
      const day = job.publishedAt.toISOString().slice(0, 10);

      console.log(`  ${day}  ${job.source.padEnd(13)}  ${job.company} — ${job.title}`);
    }

    if (targets.length > PREVIEW_LIMIT) {
      console.log(`  ... e mais ${targets.length - PREVIEW_LIMIT}.`);
    }

    if (!apply) {
      console.log(`\nSimulacao: nada foi apagado. Rode de novo com ${APPLY_FLAG} para excluir.`);

      return;
    }

    const { count } = await prisma.job.deleteMany({ where: { scope: 'INTERNATIONAL' } });

    console.log(`\n${count} vaga(s) excluida(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`\nFalhou: ${message}`);
  console.error('\nConfira se o DATABASE_URL do .env aponta para o banco certo.\n');
  process.exit(1);
});
