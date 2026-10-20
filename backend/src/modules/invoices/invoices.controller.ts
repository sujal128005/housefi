import { Controller, Get, HttpCode, Param, Post, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { RateLimit } from '../../common/rate-limit/rate-limit.guard';
import { type AuthUser, CurrentUser, Public, Roles } from '../auth/auth.guard';
import { InvoicesService } from './invoices.service';

/** The customer asks for a download link for their invoice (valid 15 minutes). */
@Controller('bookings')
@Roles('CUSTOMER')
export class InvoiceLinkController {
  constructor(private readonly invoices: InvoicesService) {}

  @Post(':bookingId/invoice-link')
  @HttpCode(200)
  @RateLimit({ limit: 20, windowSec: 600 })
  link(@CurrentUser() user: AuthUser, @Param('bookingId') id: string): Promise<{ path: string; expiresAt: number }> {
    return this.invoices.link(user.id, id);
  }
}

/** The PDF behind a signed link: opened in the phone's browser, so no sign-in header (the link is the key). */
@Controller('invoices')
@Public()
export class InvoicePdfController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get(':token')
  @RateLimit({ limit: 30, windowSec: 600 })
  async pdf(@Param('token') token: string, @Res() reply: FastifyReply): Promise<void> {
    const { pdf, filename } = await this.invoices.pdfForLink(token.replace(/\.pdf$/, ''));
    await reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `inline; filename="${filename}"`)
      .header('cache-control', 'private, no-store')
      .send(pdf);
  }
}
