import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { AppError } from '../../common/errors/app-error';
import { streamSse } from '../../common/http/sse';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.guard';
import { BookingUpdates } from './booking-updates';
import type { BookingDto } from './booking-view';
import { CancelBody, IdempotencyKey, ListQuery, NewBooking, RatingInput, RescheduleBody } from './bookings.schemas';
import { BookingsService } from './bookings.service';

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

  @Post(':bookingId/rating')
  @HttpCode(200)
  rate(@CurrentUser() user: AuthUser, @Param('bookingId') id: string, @Body(new ZodValidationPipe(RatingInput)) body: z.infer<typeof RatingInput>): Promise<BookingDto> {
    return this.bookings.rate(user.id, id, body);
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
    streamSse(req, reply, {
      event: 'booking',
      first,
      reload: () => this.bookings.get(user.id, id),
      subscribe: (onChange) => this.updates.subscribe(id, onChange),
    });
  }
}
