import { type ArgumentsHost, Catch, type ExceptionFilter } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { toErrorResponse } from './error-response';

/** Every error leaves the API in the contract's shape. Registered globally in AppModule. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    sendError(exception, req, reply);
  }
}

/** Shared by the Nest filter and Fastify's own error handler (body parsing errors happen before Nest). */
export function sendError(exception: unknown, req: FastifyRequest, reply: FastifyReply): void {
  const { status, body, unexpected } = toErrorResponse(exception, req.id);
  if (unexpected) req.log.error({ err: exception }, 'unexpected error');
  else req.log.info({ errorCode: body.error.code, status }, 'request rejected');
  if (body.error.retryAfterSec !== undefined) void reply.header('retry-after', String(body.error.retryAfterSec));
  void reply.status(status).header('cache-control', 'no-store').send(body);
}
