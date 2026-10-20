// The super admin portal's API (/v1/admin/...), answered only for the portal's secret host (AdminHostGuard).
import { Body, Controller, Get, HttpCode, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { Public } from '../auth/auth.guard';
import { AdminAuthService, MAX_SESSION_MS, PASSKEY_STEP_MS, type SignedInAdmin } from './admin-auth.service';
import { AdminGuard, AdminHostGuard, adminToken, CurrentAdmin, requester, setAdminCookie } from './admin.guard';
import { AdminOverviewService, type OverviewDto } from './admin-overview.service';
import { AdminRecoveryService, RECOVERY_COOKIE, type RecoveryStatusDto } from './admin-recovery.service';

const PasswordBody = z.object({ username: z.string().min(1).max(60), password: z.string().min(1).max(200) }).strict();
const PasskeyBody = z.object({ response: z.record(z.string(), z.unknown()), deviceName: z.string().max(60).default('Laptop') }).strict();
const RecoverBody = z.object({ username: z.string().min(1).max(60), phone: z.string().min(10).max(20), code: z.string().min(4).max(12) }).strict();
const NewPasswordBody = z.object({ password: z.string().min(1).max(200) }).strict();

function recoveryToken(req: FastifyRequest): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === RECOVERY_COOKIE) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

function setRecoveryCookie(reply: FastifyReply, token: string, maxAgeSec: number): void {
  void reply.header('set-cookie', `${RECOVERY_COOKIE}=${token}; Path=/v1/admin/recovery; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSec}`);
}

type MeDto = { id: string; username: string; displayName: string; recoveries: Awaited<ReturnType<AdminRecoveryService['waiting']>> };

@Controller('admin')
@Public()
@UseGuards(AdminHostGuard)
export class AdminController {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly recovery: AdminRecoveryService,
    private readonly overviewService: AdminOverviewService,
  ) {}

  // ---------- sign-in ----------

  @Post('auth/password')
  @HttpCode(200)
  async password(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply, @Body(new ZodValidationPipe(PasswordBody)) body: z.infer<typeof PasswordBody>): Promise<{ next: 'REGISTER' | 'PASSKEY' }> {
    const { token, next } = await this.auth.password(body.username, body.password, requester(req));
    setAdminCookie(reply, token, PASSKEY_STEP_MS / 1000);
    return { next };
  }

  @Post('auth/passkey/options')
  @HttpCode(200)
  passkeyOptions(@Req() req: FastifyRequest): Promise<{ mode: 'REGISTER' | 'PASSKEY'; options: unknown }> {
    return this.auth.passkeyOptions(adminToken(req) ?? '', requester(req));
  }

  @Post('auth/passkey/verify')
  @HttpCode(200)
  async passkeyVerify(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply, @Body(new ZodValidationPipe(PasskeyBody)) body: z.infer<typeof PasskeyBody>): Promise<{ ok: true }> {
    const { token } = await this.auth.passkeyVerify(adminToken(req) ?? '', body.response, body.deviceName, requester(req));
    setAdminCookie(reply, token, MAX_SESSION_MS / 1000);
    return { ok: true };
  }

  @Post('auth/logout')
  @HttpCode(204)
  async logout(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<void> {
    await this.auth.signOut(adminToken(req), requester(req));
    setAdminCookie(reply, '', 0);
  }

  // ---------- forgot password ----------

  @Post('recovery/start')
  @HttpCode(200)
  async recoveryStart(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply, @Body(new ZodValidationPipe(RecoverBody)) body: z.infer<typeof RecoverBody>): Promise<{ readyAt: number }> {
    const { token, readyAt } = await this.recovery.start(body.username, body.phone, body.code, requester(req));
    setRecoveryCookie(reply, token, 2 * 24 * 3600);
    return { readyAt };
  }

  @Get('recovery/status')
  recoveryStatus(@Req() req: FastifyRequest): Promise<RecoveryStatusDto> {
    return this.recovery.status(recoveryToken(req));
  }

  @Post('recovery/complete')
  @HttpCode(204)
  async recoveryComplete(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply, @Body(new ZodValidationPipe(NewPasswordBody)) body: z.infer<typeof NewPasswordBody>): Promise<void> {
    await this.recovery.complete(recoveryToken(req), body.password, requester(req));
    setRecoveryCookie(reply, '', 0);
  }

  // ---------- signed in ----------

  @Get('me')
  @UseGuards(AdminGuard)
  async me(@CurrentAdmin() admin: SignedInAdmin): Promise<MeDto> {
    return { id: admin.id, username: admin.username, displayName: admin.displayName, recoveries: await this.recovery.waiting() };
  }

  @Post('recoveries/:id/cancel')
  @HttpCode(204)
  @UseGuards(AdminGuard)
  async cancelRecovery(@CurrentAdmin() admin: SignedInAdmin, @Param('id') id: string, @Req() req: FastifyRequest): Promise<void> {
    await this.recovery.cancel(admin.id, id, requester(req).ip);
  }

  @Get('overview')
  @UseGuards(AdminGuard)
  overview(): Promise<OverviewDto> {
    return this.overviewService.overview();
  }
}
