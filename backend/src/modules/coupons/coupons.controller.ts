import { Body, Controller, Delete, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { RateLimit } from '../../common/rate-limit/rate-limit.guard';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.guard';
import type { BookingDto } from '../bookings/booking-view';
import { type CouponResult, CouponsService } from './coupons.service';

const CouponBody = z.object({ code: z.string().trim().min(1).max(30) }).strict();

/** A coupon on the final bill (while it is due). An unusable code is answered with why, not an error. */
@Controller('bookings')
@Roles('CUSTOMER')
export class CouponsController {
  constructor(private readonly coupons: CouponsService) {}

  @Post(':bookingId/coupon')
  @HttpCode(200)
  // Guessing codes is slow.
  @RateLimit({ limit: 10, windowSec: 600 })
  apply(@CurrentUser() user: AuthUser, @Param('bookingId') id: string, @Body(new ZodValidationPipe(CouponBody)) body: z.infer<typeof CouponBody>): Promise<CouponResult> {
    return this.coupons.apply(user.id, id, body.code);
  }

  @Delete(':bookingId/coupon')
  @HttpCode(200)
  remove(@CurrentUser() user: AuthUser, @Param('bookingId') id: string): Promise<BookingDto> {
    return this.coupons.remove(user.id, id);
  }
}
