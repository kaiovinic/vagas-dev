import { ArgumentsHost, Catch, HttpStatus, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';

import {
  ProfileNotReadyForResumeError,
  ResumeGenerationFailedError,
  ResumeTargetNotFoundError,
} from '@/domain/errors/resume-errors';

type ResumeError =
  | ResumeTargetNotFoundError
  | ProfileNotReadyForResumeError
  | ResumeGenerationFailedError;

/**
 * Cada falha da geracao pede uma resposta diferente do painel: vaga que nao
 * existe e 404, perfil incompleto e 422 (o usuario conserta), e falha do
 * provedor e 502 — nao ha o que o usuario faca alem de tentar de novo.
 */
const STATUS_BY_ERROR: Record<string, HttpStatus> = {
  ResumeTargetNotFoundError: HttpStatus.NOT_FOUND,
  ProfileNotReadyForResumeError: HttpStatus.UNPROCESSABLE_ENTITY,
  ResumeGenerationFailedError: HttpStatus.BAD_GATEWAY,
};

@Catch(ResumeTargetNotFoundError, ProfileNotReadyForResumeError, ResumeGenerationFailedError)
export class ResumeExceptionFilter implements ExceptionFilter<ResumeError> {
  catch(exception: ResumeError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const statusCode = STATUS_BY_ERROR[exception.name] ?? HttpStatus.BAD_GATEWAY;

    response.status(statusCode).json({
      statusCode,
      error: exception.name,
      message: exception.message,
    });
  }
}
