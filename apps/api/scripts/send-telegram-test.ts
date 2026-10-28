/**
 * Envia uma mensagem de teste para o chat configurado.
 *
 *   npm run telegram:test --workspace @devradar/api
 *
 * Usa o mesmo adaptador da captura, entao se este comando funciona, os alertas
 * das vagas tambem funcionam.
 */
import 'reflect-metadata';

import { AxiosHttpClient } from '@/infra/http/axios-http-client';
import {
  TelegramHttpNotifier,
  buildMessage,
} from '@/infra/notifications/telegram-http-notifier';
import { Job } from '@/domain/entities/job';

const EXEMPLO = {
  job: Job.create({
    title: 'Pessoa Desenvolvedora Frontend React Senior',
    company: 'Empresa de Teste',
    source: 'gupy',
    url: 'https://portal.gupy.io/job-search/term=frontend',
    publishedAt: new Date(),
    description: 'Mensagem de teste do DevRadar.',
    location: 'Salvador/BA',
    workModel: 'REMOTE' as const,
  }),
  tags: ['React', 'TypeScript', 'Node.js'],
  scope: 'NATIONAL' as const,
};

async function main(): Promise<void> {
  const notifier = new TelegramHttpNotifier(new AxiosHttpClient());

  console.log('Enviando mensagem de teste para o chat do Telegram...\n');
  console.log(buildMessage(EXEMPLO));
  console.log('');

  await notifier.sendRaw(
    `✅ <b>DevRadar conectado</b>\nEste e um teste de envio. Abaixo, o formato de um alerta de vaga:`,
  );
  await notifier.sendRaw(buildMessage(EXEMPLO));

  console.log('Enviado. Confira o chat.');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`\nFalhou: ${message}`);
  console.error(
    '\nConfira no .env:\n' +
      '  TELEGRAM_BOT_TOKEN  (pegue com o @BotFather no Telegram)\n' +
      '  TELEGRAM_CHAT_ID    (id do canal/grupo, ex.: -1001234567890)\n',
  );
  process.exit(1);
});
