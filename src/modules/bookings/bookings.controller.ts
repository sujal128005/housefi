import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { AppError } from '../../common/errors/app-error';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.guard';
import { BookingUpdates } from './booking-updates';
import type { BookingDto } from './booking-view';
import { CancelBody, IdempotencyKey, ListQuery, NewBooking, RescheduleBody } from './bookings.schemas';
import { BookingsService } from './bookings.service';

/** Comment lines keep proxies and load balancers from closing an idle stream. */
export const STREAM_HEARTBEAT_MS = 25_000;

@Controller('bookings')
@Roles('CUSTOMER')
export class BookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly updates: BookingUpdates,
  ) {}

  @Post()
  @HttpCode(201)
  async create(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(NewBooking)) input: NewBooking,
  ): Promise<BookingDto> {
    if (!key) throw new AppError('VALIDATION', { fields: { 'Idempotency-Key': 'REQUIRED' } });
    if (!IdempotencyKey.safeParse(key).success) throw new AppError('VALIDATION', { fields: { 'Idempotency-Key': 'INVALID' } });
    return (await this.bookings.create(user.id, key, input)).booking;
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(ListQuery)) q: z.infer<typeof ListQuery>): Promise<BookingDto[]> {
    return this.bookings.list(user.id, q.scope);
  }

  @Get(':bookingId')
  get(@CurrentUser() user: AuthUser, @Param('bookingId') id: string): Promise<BookingDto> {
    return this.bookings.get(user.id, id);
  }

  @Post(':bookingId/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('bookingId') id: string, @Body(new ZodValidationPipe(CancelBody)) reason: z.infer<typeof CancelBody>): Promise<BookingDto> {
    return this.bookings.cancel(user.id, id, reason);
  }

  @Post(':bookingId/reschedule')
  @HttpCode(200)
  reschedule(@CurrentUser() user: AuthUser, @Param('bookingId') id: string, @Body(new ZodValidationPipe(RescheduleBody)) body: z.infer<typeof RescheduleBody>): Promise<BookingDto> {
    return this.bookings.reschedule(user.id, id, body.time);
  }

  /**
   * Live updates (Server-Sent Events): an event `booking` with the full Booking right away and after every change.
   * Ownership is checked before the stream opens, so others get the usual NOT_FOUND error body.
   */
  @Get(':bookingId/stream')
  async stream(@CurrentUser() user: AuthUser, @Param('bookingId') id: string, @Req() req: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    const first = await this.bookings.get(user.id, id);
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      ...(reply.getHeaders() as Record<string, string>),
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    let open = true;
    const send = (b: BookingDto) => {
      if (open) raw.write(`event: booking\ndata: ${JSON.stringify(b)}\n\n`);
    };
    raw.write('retry: 3000\n\n');
    send(first);

    let last = JSON.stringify(first);
    const unsubscribe = this.updates.subscribe(id, () => {
      this.bookings
        .get(user.id, id)
        .then((b) => {
          const json = JSON.stringify(b);
          if (json !== last) {
            last = json;
            send(b);
          }
        })
        .catch((err: Error) => {
          req.log.warn({ err }, 'booking stream reload failed');
        });
    });
    const heartbeat = setInterval(() => open && raw.write(': ping\n\n'), STREAM_HEARTBEAT_MS);
    const close = () => {
      open = false;
      clearInterval(heartbeat);
      unsubscribe();
    };
    raw.on('close', close);
    req.raw.on('close', close);
  }
}
