import { Body, Controller, Headers, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../common/errors/app-error';
import { SkipRateLimit } from '../../common/rate-limit/rate-limit.guard';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { type AuthUser, CurrentUser, Public, Roles } from '../auth/auth.guard';
import { BookingCore } from '../bookings/booking-core';
import type { BookingDto } from '../bookings/booking-view';
import { IdempotencyKey } from '../bookings/bookings.schemas';
import { type PaymentOrderDto, type PaymentResultDto, PaymentsService } from './payments.service';

const StartBody = z.object({
  kind: z.enum(['VISIT', 'FINAL']),
  method: z.enum(['UPI', 'CARD', 'NETBANKING', 'CASH']),
});

const VerifyBody = z.object({
  razorpayOrderId: z.string().min(1).max(64),
  razorpayPaymentId: z.string().min(1).max(64),
  razorpaySignature: z.string().min(1).max(128),
});

@Controller()
@Roles('CUSTOMER')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly core: BookingCore,
  ) {}

  /** Razorpay order for the checkout sheet, or (CASH, bill only) the booking waiting for the technician. */
  @Post('bookings/:bookingId/payments')
  @HttpCode(200)
  async start(
    @CurrentUser() user: AuthUser,
    @Param('bookingId') bookingId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(StartBody)) body: z.infer<typeof StartBody>,
  ): Promise<PaymentOrderDto | BookingDto> {
    if (!key) throw new AppError('VALIDATION', { fields: { 'Idempotency-Key': 'REQUIRED' } });
    if (!IdempotencyKey.safeParse(key).success) throw new AppError('VALIDATION', { fields: { 'Idempotency-Key': 'INVALID' } });
    const result = await this.payments.start(user.id, bookingId, body.kind, body.method, key);
    return result.kind === 'order' ? result.order : this.core.get(user.id, bookingId);
  }

  @Post('payments/:paymentId/verify')
  @HttpCode(200)
  verify(@CurrentUser() user: AuthUser, @Param('paymentId') paymentId: string, @Body(new ZodValidationPipe(VerifyBody)) body: z.infer<typeof VerifyBody>): Promise<PaymentResultDto> {
    return this.payments.verify(user.id, paymentId, body);
  }
}

/** Server-to-server from Razorpay: no token; authenticated by the signature over the raw body. */
@Controller('webhooks')
@Public()
@SkipRateLimit()
export class WebhooksController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('razorpay')
  @HttpCode(200)
  async razorpay(
    @Req() req: RawBodyRequest<FastifyRequest>,
    @Headers('x-razorpay-signature') signature: string | undefined,
    @Headers('x-razorpay-event-id') eventId: string | undefined,
  ): Promise<{ status: 'ok' }> {
    if (!req.rawBody) throw new AppError('VALIDATION');
    await this.payments.handleWebhook(req.rawBody, signature, eventId);
    return { status: 'ok' };
  }
}
