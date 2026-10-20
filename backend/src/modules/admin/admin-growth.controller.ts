// The portal's growth API: services and prices, the parts price list, coupons, announcements, and invoice PDFs.
// Signed-in admins only, on the portal's secret host only.
import { Body, Controller, Get, HttpCode, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { Public } from '../auth/auth.guard';
import { InvoicesService } from '../invoices/invoices.service';
import type { SignedInAdmin } from './admin-auth.service';
import type { AdminActor } from './admin-bookings.service';
import { AdminGrowthService, type AdminServiceDto, type CouponDto } from './admin-growth.service';
import { AdminGuard, AdminHostGuard, CurrentAdmin, requester } from './admin.guard';

const Category = z.enum(['PLUMBING', 'ELECTRICAL', 'AC', 'APPLIANCE', 'CLEANING', 'CARPENTRY']);
const Text2 = (max: number) => z.object({ en: z.string().max(max), te: z.string().max(max * 2).default('') });
const ServiceBody = z
  .object({
    categoryId: Category,
    name: Text2(60),
    description: Text2(300),
    visitFee: z.number().int().min(0).max(5000),
    repairFrom: z.number().int().min(1).max(200_000),
    repairTypicalMax: z.number().int().min(1).max(500_000),
    durationMin: z.number().int().min(5).max(600),
    durationMax: z.number().int().min(5).max(1440),
    popular: z.boolean(),
    active: z.boolean(),
    keywords: z.array(z.string().max(40)).max(30).default([]),
    issues: z.array(z.object({ id: z.string().max(64).optional(), name: Text2(60) })).min(1).max(20),
  })
  .strict();
const PartBody = z
  .object({ categoryId: Category, serviceId: z.string().max(64).nullable().default(null), name: Text2(60), unit: z.string().max(12), price: z.number().int().min(1).max(200_000), active: z.boolean(), sort: z.number().int().min(0).max(10_000).default(0) })
  .strict();
const CouponBody = z
  .object({
    code: z.string().max(30),
    description: z.string().max(200).default(''),
    kind: z.enum(['FLAT', 'PERCENT']),
    value: z.number().int().min(1).max(10_000),
    maxDiscount: z.number().int().min(1).max(100_000).nullable().default(null),
    minBill: z.number().int().min(0).max(1_000_000).default(0),
    validFrom: z.number().int().positive().nullable().default(null),
    validTo: z.number().int().positive().nullable().default(null),
    maxUses: z.number().int().min(1).max(1_000_000).nullable().default(null),
    perCustomer: z.number().int().min(1).max(50).default(1),
    firstBookingOnly: z.boolean().default(false),
    active: z.boolean().default(true),
  })
  .strict();
const AnnounceBody = z.object({ audience: z.enum(['CUSTOMERS', 'TECHNICIANS', 'ALL', 'DEMO']), title: Text2(60), body: Text2(300) }).strict();

function actor(admin: SignedInAdmin, req: FastifyRequest): AdminActor {
  return { type: 'ADMIN', id: admin.id, ip: requester(req).ip };
}

@Controller('admin')
@Public()
@UseGuards(AdminHostGuard, AdminGuard)
export class AdminGrowthController {
  constructor(
    private readonly growth: AdminGrowthService,
    private readonly invoices: InvoicesService,
  ) {}

  @Get('services')
  services(): Promise<AdminServiceDto[]> {
    return this.growth.services();
  }

  @Post('services')
  @HttpCode(201)
  createService(@CurrentAdmin() admin: SignedInAdmin, @Req() req: FastifyRequest, @Body(new ZodValidationPipe(ServiceBody)) body: z.infer<typeof ServiceBody>): Promise<AdminServiceDto> {
    return this.growth.saveService(null, body, actor(admin, req));
  }

  @Post('services/:id')
  @HttpCode(200)
  updateService(@CurrentAdmin() admin: SignedInAdmin, @Req() req: FastifyRequest, @Param('id') id: string, @Body(new ZodValidationPipe(ServiceBody)) body: z.infer<typeof ServiceBody>): Promise<AdminServiceDto> {
    return this.growth.saveService(id, body, actor(admin, req));
  }

  @Get('parts')
  parts() {
    return this.growth.parts();
  }

  @Post('parts')
  @HttpCode(204)
  createPart(@CurrentAdmin() admin: SignedInAdmin, @Req() req: FastifyRequest, @Body(new ZodValidationPipe(PartBody)) body: z.infer<typeof PartBody>): Promise<void> {
    return this.growth.savePart(null, body, actor(admin, req));
  }

  @Post('parts/:id')
  @HttpCode(204)
  updatePart(@CurrentAdmin() admin: SignedInAdmin, @Req() req: FastifyRequest, @Param('id') id: string, @Body(new ZodValidationPipe(PartBody)) body: z.infer<typeof PartBody>): Promise<void> {
    return this.growth.savePart(id, body, actor(admin, req));
  }

  @Get('coupons')
  coupons(): Promise<CouponDto[]> {
    return this.growth.coupons();
  }

  @Post('coupons')
  @HttpCode(204)
  createCoupon(@CurrentAdmin() admin: SignedInAdmin, @Req() req: FastifyRequest, @Body(new ZodValidationPipe(CouponBody)) body: z.infer<typeof CouponBody>): Promise<void> {
    return this.growth.saveCoupon(null, body, actor(admin, req));
  }

  @Post('coupons/:id')
  @HttpCode(204)
  updateCoupon(@CurrentAdmin() admin: SignedInAdmin, @Req() req: FastifyRequest, @Param('id') id: string, @Body(new ZodValidationPipe(CouponBody)) body: z.infer<typeof CouponBody>): Promise<void> {
    return this.growth.saveCoupon(id, body, actor(admin, req));
  }

  @Get('announcements')
  announcements() {
    return this.growth.announcements();
  }

  @Post('announcements')
  @HttpCode(200)
  announce(@CurrentAdmin() admin: SignedInAdmin, @Req() req: FastifyRequest, @Body(new ZodValidationPipe(AnnounceBody)) body: z.infer<typeof AnnounceBody>): Promise<{ recipients: number }> {
    return this.growth.announce(body, actor(admin, req));
  }

  /** The invoice PDF of a completed booking (opens in a new tab). */
  @Get('bookings/:id/invoice')
  async invoice(@Param('id') id: string, @Res() reply: FastifyReply): Promise<void> {
    const { pdf, filename } = await this.invoices.pdf(id);
    await reply.header('content-type', 'application/pdf').header('content-disposition', `inline; filename="${filename}"`).header('cache-control', 'no-store').send(pdf);
  }
}
