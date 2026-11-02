import {
  ArgumentsHost,
  Catch,
  HttpStatus,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';

import { InvalidCandidateProfileError } from '@/domain/errors/invalid-candidate-profile-error';
import { InvalidJobError } from '@/domain/errors/invalid-job-error';

type DomainError = InvalidJobError | InvalidCandidateProfileError;

/** Erro de invariante do dominio e entrada invalida do cliente, nao falha do servidor. */
@Catch(InvalidJobError, InvalidCandidateProfileError)
export class DomainExceptionFilter implements ExceptionFilter<DomainError> {
  catch(exception: DomainError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    response.status(HttpStatus.BAD_REQUEST).json({
      statusCode: HttpStatus.BAD_REQUEST,
      error: exception.name,
      message: exception.message,
    });
  }
}
