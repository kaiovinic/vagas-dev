import {
  ArgumentsHost,
  Catch,
  HttpStatus,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';

import { InvalidJobError } from '@/domain/errors/invalid-job-error';

/** Erro de invariante do dominio e entrada invalida do cliente, nao falha do servidor. */
@Catch(InvalidJobError)
export class DomainExceptionFilter implements ExceptionFilter<InvalidJobError> {
  catch(exception: InvalidJobError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    response.status(HttpStatus.BAD_REQUEST).json({
      statusCode: HttpStatus.BAD_REQUEST,
      error: exception.name,
      message: exception.message,
    });
  }
}
