import 'reflect-metadata';
// Carrega o .env antes de qualquer provider ler process.env. O `nest start` nao
// faz isso sozinho: sem esta linha, o notificador do Telegram subiria sem token
// e os alertas virariam no-op silencioso. Em container, o arquivo nao existe e o
// dotenv ignora — as variaveis ja vem do ambiente.
import 'dotenv/config';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '@/app.module';
import { DomainExceptionFilter } from '@/http/filters/domain-exception.filter';

const DEFAULT_PORT = 3333;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Encerra cron e conexoes do Prisma antes do processo morrer.
  app.enableShutdownHooks();
  app.useGlobalFilters(new DomainExceptionFilter());
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? '*' });

  await app.listen(process.env.PORT ?? DEFAULT_PORT);
}

void bootstrap();
