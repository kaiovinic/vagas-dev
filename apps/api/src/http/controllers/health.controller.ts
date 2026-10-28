import { Controller, Get, HttpStatus, Logger, Res } from '@nestjs/common';
import type { Response } from 'express';

import { PrismaService } from '@/infra/prisma/prisma.service';

export interface HealthResponse {
  readonly status: 'ok' | 'error';
  readonly database: 'up' | 'down';
}

@Controller('api/health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Prontidao real: consulta o banco em vez de responder 200 so porque o
   * processo subiu. O orquestrador usa isto para nao mandar trafego para uma
   * API que ainda nao fala com o PostgreSQL.
   */
  @Get()
  async check(@Res() response: Response<HealthResponse>): Promise<void> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;

      response.status(HttpStatus.OK).json({ status: 'ok', database: 'up' });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      // A causa fica no log do servidor; a resposta nao expoe detalhe de conexao.
      this.logger.error(`Banco indisponivel no healthcheck: ${message}`);

      response.status(HttpStatus.SERVICE_UNAVAILABLE).json({ status: 'error', database: 'down' });
    }
  }
}
