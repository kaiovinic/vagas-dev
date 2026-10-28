import { PrismaClient } from '@prisma/client';

import { PrismaService } from '@/infra/prisma/prisma.service';

export const INTEGRATION_DATABASE_URL =
  process.env.DATABASE_URL_TEST ??
  'postgresql://devradar:devradar@localhost:5432/devradar_test?schema=public';

/**
 * Cliente apontado para o banco de integracao. Nunca usa o `DATABASE_URL` de
 * desenvolvimento, para que um `TRUNCATE` aqui jamais apague dados de captura.
 */
export function createTestPrisma(): PrismaService {
  const client = new PrismaClient({
    datasources: { db: { url: INTEGRATION_DATABASE_URL } },
  });

  return client as PrismaService;
}

/** Zera as tabelas entre os casos, reiniciando qualquer sequencia. */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "jobs", "capture_logs" RESTART IDENTITY CASCADE');
}
