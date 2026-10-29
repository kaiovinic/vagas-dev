/**
 * Dispara o resumo semanal agora, sem esperar a segunda-feira.
 *
 *   npm run telegram:digest --workspace @devradar/api
 *
 * Usa o caso de uso real, com o banco real e o mesmo notificador do cron: se
 * este comando funciona, o disparo de segunda tambem funciona.
 */
import 'reflect-metadata';
import 'dotenv/config';

import { PrismaClient } from '@prisma/client';

import { SendWeeklyDigestUseCase } from '@/application/use-cases/send-weekly-digest.use-case';
import { AxiosHttpClient } from '@/infra/http/axios-http-client';
import {
  TelegramHttpNotifier,
  buildDigestMessage,
} from '@/infra/notifications/telegram-http-notifier';
import { PrismaWeeklyDigestRepository } from '@/infra/prisma/prisma-weekly-digest-repository';
import type { PrismaService } from '@/infra/prisma/prisma.service';

async function main(): Promise<void> {
  const prisma = new PrismaClient() as PrismaService;

  try {
    const useCase = new SendWeeklyDigestUseCase(
      new PrismaWeeklyDigestRepository(prisma),
      new TelegramHttpNotifier(new AxiosHttpClient()),
    );

    console.log('Consolidando a semana...\n');

    const digest = await useCase.execute();

    console.log(buildDigestMessage(digest));
    console.log('\nEnviado. Confira o chat.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`\nFalhou: ${message}`);
  console.error(
    '\nConfira no .env:\n' +
      '  DATABASE_URL\n' +
      '  TELEGRAM_BOT_TOKEN  (pegue com o @BotFather no Telegram)\n' +
      '  TELEGRAM_CHAT_ID    (id do canal/grupo)\n',
  );
  process.exit(1);
});
