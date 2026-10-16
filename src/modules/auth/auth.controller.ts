import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { RateLimit } from '../../common/rate-limit/rate-limit.guard';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { type AuthUser, CurrentUser, Public } from './auth.guard';
import { LogoutBody, OtpRequestBody, OtpVerifyBody, RefreshBody } from './auth.schemas';
import { type AuthResultDto, AuthService } from './auth.service';
import { type OtpChallengeDto, OtpService } from './otp.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly otp: OtpService,
    private readonly auth: AuthService,
  ) {}

  /** Sends a 6-digit SMS code. Per-phone limits (5 per hour, resend after 30 s) are enforced in OtpService. */
  @Post('otp/request')
  @Public()
  @HttpCode(200)
  @RateLimit({ limit: 10, windowSec: 600 })
  request(@Body(new ZodValidationPipe(OtpRequestBody)) body: z.infer<typeof OtpRequestBody>, @Req() req: FastifyRequest): Promise<OtpChallengeDto> {
    return this.otp.request(body.phone, body.role, req.ip ?? null);
  }

  @Post('otp/verify')
  @Public()
  @HttpCode(200)
  @RateLimit({ limit: 20, windowSec: 600 })
  verify(@Body(new ZodValidationPipe(OtpVerifyBody)) body: z.infer<typeof OtpVerifyBody>): Promise<AuthResultDto> {
    return this.auth.verifyOtp(body.challengeId, body.code);
  }

  /** Called at app start and on 401. The old refresh token stops working; the response carries the new one. */
  @Post('refresh')
  @Public()
  @HttpCode(200)
  @RateLimit({ limit: 30, windowSec: 600 })
  refresh(@Body(new ZodValidationPipe(RefreshBody)) body: z.infer<typeof RefreshBody>): Promise<AuthResultDto> {
    return this.auth.refresh(body.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(LogoutBody)) body: z.infer<typeof LogoutBody>): Promise<void> {
    await this.auth.logout(user.id, user.sessionId, body.refreshToken);
  }
}
