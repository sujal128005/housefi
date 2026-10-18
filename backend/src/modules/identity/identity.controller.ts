import { Body, Controller, Get, Header, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { RateLimit } from '../../common/rate-limit/rate-limit.guard';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { type AuthUser, CurrentUser, Public, Roles } from '../auth/auth.guard';
import { type TechProfileDto, TechniciansService } from '../technicians/technicians.service';
import { type AadhaarResultDto, IdentityService, type TechIdCardDto, type TechVerifyResultDto } from './identity.service';

const CorrectionBody = z.object({ kind: z.enum(['NAME', 'PHOTO']), note: z.string().trim().min(3).max(300) }).strict();
/** The decimal text the camera reads from an Aadhaar Secure QR (a few thousand digits). */
const AadhaarBody = z.object({ qr: z.string().trim().min(50).max(8000) }).strict();

/** Technician ID cards, identity corrections, Aadhaar checks, and the public QR verification. */
@Controller()
export class IdentityController {
  constructor(
    private readonly identity: IdentityService,
    private readonly technicians: TechniciansService,
  ) {}

  @Get('tech/id-card')
  @Roles('TECHNICIAN')
  @Header('Cache-Control', 'no-store')
  idCard(@CurrentUser() user: AuthUser): Promise<TechIdCardDto> {
    return this.identity.idCard(user.id);
  }

  @Post('tech/identity-corrections')
  @Roles('TECHNICIAN')
  @HttpCode(200)
  @RateLimit({ limit: 5, windowSec: 3600 })
  async correction(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(CorrectionBody)) body: z.infer<typeof CorrectionBody>): Promise<TechProfileDto> {
    await this.identity.requestCorrection(user.id, body.kind, body.note);
    return this.technicians.me(user.id);
  }

  /** The technician scans the Secure QR on their own Aadhaar. */
  @Post('tech/aadhaar')
  @Roles('TECHNICIAN')
  @HttpCode(200)
  @RateLimit({ limit: 10, windowSec: 3600 })
  aadhaar(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(AadhaarBody)) body: z.infer<typeof AadhaarBody>): Promise<AadhaarResultDto> {
    return this.identity.verifyAadhaar(user.id, body.qr, { type: 'TECHNICIAN', id: user.id });
  }

  /** A coordinator scans the Aadhaar QR of one of their technicians (keypad phones cannot use the app). */
  @Post('coordinator/technicians/:technicianId/aadhaar')
  @Roles('COORDINATOR')
  @HttpCode(200)
  @RateLimit({ limit: 30, windowSec: 3600 })
  coordinatorAadhaar(@CurrentUser() user: AuthUser, @Param('technicianId') id: string, @Body(new ZodValidationPipe(AadhaarBody)) body: z.infer<typeof AadhaarBody>): Promise<AadhaarResultDto> {
    return this.identity.verifyAadhaar(id, body.qr, { type: 'COORDINATOR', id: user.id });
  }

  @Get('bookings/:bookingId/technician-card')
  @Roles('CUSTOMER')
  @Header('Cache-Control', 'no-store')
  technicianCard(@CurrentUser() user: AuthUser, @Param('bookingId') bookingId: string): Promise<TechIdCardDto> {
    return this.identity.cardForBooking(user.id, bookingId);
  }

  /** The QR code's target: no sign-in, rate-limited per IP, never cached. */
  @Get('verify/technicians/:token')
  @Public()
  @RateLimit({ limit: 30, windowSec: 60 })
  @Header('Cache-Control', 'no-store')
  verify(@Param('token') token: string): Promise<TechVerifyResultDto> {
    return this.identity.verifyPublic(token);
  }
}
