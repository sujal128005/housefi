import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../../common/errors/app-error';
import { ipBucket, RateLimit } from '../../common/rate-limit/rate-limit.guard';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { InjectConfig } from '../../config/config.module';
import type { Env } from '../../config/env';
import { type AuthUser, CurrentUser, Public, Roles } from '../auth/auth.guard';
import { type Branch, type CallbackParams, TelephonyService } from './telephony.service';

const PhoneSetupBody = z
  .object({
    phoneType: z.enum(['SMARTPHONE', 'KEYPAD', 'NONE']),
    pin: z.string().regex(/^[0-9]{4}$/).optional(),
    callHours: z.object({ start: z.number().int().min(0).max(23), end: z.number().int().min(1).max(24) }).optional(),
    consent: z.boolean().default(false),
  })
  .strict();
const AvailabilityBody = z.object({ online: z.boolean() }).strict();

/** Masked calls from the app, and coordinators setting up their keypad-phone technicians. */
@Controller()
export class TelephonyController {
  constructor(private readonly telephony: TelephonyService) {}

  /** openapi.yaml: the number to dial; it connects to the assigned technician without revealing either number. */
  @Post('bookings/:bookingId/call')
  @Roles('CUSTOMER')
  @HttpCode(200)
  @RateLimit({ limit: 10, windowSec: 600 })
  customerCall(@CurrentUser() user: AuthUser, @Param('bookingId') id: string): Promise<{ dialNumber: string }> {
    return this.telephony.grantCall(user.id, 'CUSTOMER', id);
  }

  /** The same for the technician, to reach the customer of their job. */
  @Post('tech/jobs/:jobId/call')
  @Roles('TECHNICIAN')
  @HttpCode(200)
  @RateLimit({ limit: 10, windowSec: 600 })
  technicianCall(@CurrentUser() user: AuthUser, @Param('jobId') id: string): Promise<{ dialNumber: string }> {
    return this.telephony.grantCall(user.id, 'TECHNICIAN', id);
  }

  @Post('coordinator/technicians/:technicianId/phone-setup')
  @Roles('COORDINATOR')
  @HttpCode(204)
  async phoneSetup(@CurrentUser() user: AuthUser, @Param('technicianId') id: string, @Body(new ZodValidationPipe(PhoneSetupBody)) body: z.infer<typeof PhoneSetupBody>): Promise<void> {
    await this.telephony.phoneSetup(user.id, id, body);
  }

  @Post('coordinator/technicians/:technicianId/availability')
  @Roles('COORDINATOR')
  @HttpCode(204)
  async availability(@CurrentUser() user: AuthUser, @Param('technicianId') id: string, @Body(new ZodValidationPipe(AvailabilityBody)) body: z.infer<typeof AvailabilityBody>): Promise<void> {
    await this.telephony.setOnlineFor(user.id, id, body.online);
  }
}

/**
 * Callbacks from the telephony provider (Exotel). No sign-in: the URL carries EXOTEL_WEBHOOK_SECRET (and, if set,
 * only TELEPHONY_ALLOWED_IPS may call). Every handler is safe to call twice and logs no phone numbers or keypresses.
 * Passthru steps answer 200 for the flow's "yes" branch and 302 for the other.
 */
@Controller('webhooks/telephony/exotel/:secret')
@Public()
@RateLimit({ limit: 600, windowSec: 60 })
export class TelephonyWebhookController {
  constructor(
    private readonly telephony: TelephonyService,
    @InjectConfig() private readonly config: Env,
  ) {}

  /** The words of the offer call, as plain text (Exotel Greeting with dynamic text). */
  @Get('prompt')
  async prompt(@Param('secret') secret: string, @Req() req: FastifyRequest, @Query() q: CallbackParams, @Res() reply: FastifyReply): Promise<void> {
    this.check(secret, req);
    void reply.code(200).type('text/plain; charset=utf-8').send(await this.telephony.offerPrompt(q));
  }

  @Get('choice')
  async choice(@Param('secret') secret: string, @Req() req: FastifyRequest, @Query() q: CallbackParams, @Res() reply: FastifyReply): Promise<void> {
    this.check(secret, req);
    this.branch(reply, await this.telephony.offerChoice(q));
  }

  @Get('pin')
  async pin(@Param('secret') secret: string, @Req() req: FastifyRequest, @Query() q: CallbackParams, @Res() reply: FastifyReply): Promise<void> {
    this.check(secret, req);
    this.branch(reply, await this.telephony.offerPin(q));
  }

  @Get('availability')
  async availability(@Param('secret') secret: string, @Req() req: FastifyRequest, @Query() q: CallbackParams, @Res() reply: FastifyReply): Promise<void> {
    this.check(secret, req);
    this.branch(reply, await this.telephony.availabilityByPhone(q));
  }

  /** Exotel Connect step with a dynamic number: whom to connect a masked call to (404 = nobody; the flow says so). */
  @Get('connect')
  async connect(@Param('secret') secret: string, @Req() req: FastifyRequest, @Query() q: CallbackParams, @Res() reply: FastifyReply): Promise<void> {
    this.check(secret, req);
    const number = await this.telephony.connectTarget(q);
    if (!number) {
      void reply.code(404).send({ error: 'no active call permission' });
      return;
    }
    void reply.code(200).send({
      fetch_after_attempt: false,
      destination: { numbers: [number] },
      outgoing_phone_number: this.config.EXOTEL_CALLER_ID,
      record: false,
      max_ringing_duration: 45,
      max_conversation_duration: 1800,
      start_call_playback: { playback_to: 'callee', type: 'text', value: 'Housefi call' },
    });
  }

  /** Call progress. Exotel posts JSON or a form; both are read the same way. */
  @Post('status')
  @HttpCode(200)
  async status(@Param('secret') secret: string, @Req() req: FastifyRequest, @Query() q: CallbackParams, @Body() body: unknown): Promise<{ ok: true }> {
    this.check(secret, req);
    const fields = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const params = Object.fromEntries(Object.entries({ ...q, ...fields }).filter(([, v]) => typeof v === 'string' || typeof v === 'number').map(([k, v]) => [k, String(v)]));
    await this.telephony.callStatus(params);
    return { ok: true };
  }

  private check(secret: string, req: FastifyRequest): void {
    const expected = this.config.EXOTEL_WEBHOOK_SECRET;
    const a = Buffer.from(secret);
    const b = Buffer.from(expected ?? '');
    // A wrong secret looks exactly like a missing route.
    if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) throw new AppError('NOT_FOUND');
    const allowed = this.config.TELEPHONY_ALLOWED_IPS;
    if (allowed.length > 0 && !allowed.includes(ipBucket(req.ip))) throw new AppError('NOT_FOUND');
  }

  private branch(reply: FastifyReply, b: Branch): void {
    if (b === 'yes') void reply.code(200).type('text/plain').send('OK');
    else void reply.code(302).header('Location', '/').type('text/plain').send('');
  }
}
