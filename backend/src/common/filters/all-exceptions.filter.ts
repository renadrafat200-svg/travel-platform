import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Turns every error into one consistent JSON shape:
 * { statusCode, error, message, path, timestamp }
 * Also maps common MongoDB errors (duplicate key, bad ObjectId) to proper 4xx codes.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let error = 'Internal Server Error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else {
        const b = body as { message?: string | string[]; error?: string };
        message = b.message ?? exception.message;
        error = b.error ?? exception.name;
      }
      if (typeof body === 'string') error = exception.name;
    } else if (this.isMongoDuplicateKey(exception)) {
      status = HttpStatus.CONFLICT;
      error = 'Conflict';
      const fields = Object.keys(exception.keyValue ?? {}).join(', ');
      message = `A record with this ${fields || 'value'} already exists`;
    } else if (this.isCastError(exception)) {
      status = HttpStatus.BAD_REQUEST;
      error = 'Bad Request';
      message = `Invalid ${exception.path}: ${String(exception.value)}`;
    } else {
      this.logger.error(exception);
    }

    res.status(status).json({
      statusCode: status,
      error,
      message,
      path: req.url,
      timestamp: new Date().toISOString(),
    });
  }

  private isMongoDuplicateKey(
    e: unknown,
  ): e is { code: number; keyValue?: Record<string, unknown> } {
    return typeof e === 'object' && e !== null && (e as { code?: number }).code === 11000;
  }

  private isCastError(e: unknown): e is { name: string; path: string; value: unknown } {
    return typeof e === 'object' && e !== null && (e as { name?: string }).name === 'CastError';
  }
}
