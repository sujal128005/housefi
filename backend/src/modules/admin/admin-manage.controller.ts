// The super admin portal's management API: bookings, customers, technicians, payouts. Signed-in admins only
// (password + passkey), on the portal's secret host only. Every change is audited with the admin and their IP.
import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { Public } from '../auth/auth.guard';
import { AddressesService, type AddressDto } from '../addresses/addresses.service';
import { NewBooking } from '../bookings/bookings.schemas';
import { CatalogService } from '../catalog/catalog.service';
import type { PayoutRow } from '../earnings/earnings.service';
import { type BankFilesDto, PayoutAccountsService } from '../earnings/payout-accounts.service';
import type { SignedInAdmin } from './admin-auth.service';
import { type AdminActor, type AdminBookingDetail, type AdminBookingRow, AdminBookingsService } from './admin-bookings.service';
import { AdminPeopleService, type PersonDetail, type PersonRow, type TechAction } from './admin-people.service';
import { AdminGuard, AdminHostGuard, CurrentAdmin, requester } from './admin.guard';

const Page = z.coerce.number().int().min(0).max(10_000).default(0);
const BookingList = z.object({ status: z.enum(['ACTIVE', 'SEARCHING', 'FINISHED', 'CANCELLED', 'ALL']).default('ALL'), search: z.string().max(40).optional(), page: Page });
const PeopleList = z.object({ search: z.string().max(60).optional(), filter: z.string().max(20).optional(), page: Page });
const Reason = z.string().trim().max(200).default('');
const CancelBody = z.object({ refund: z.boolean(), note: Reason }).strict();
const AssignBody = z.object({ technicianId: z.uuid() }).strict();
const CreateBody = z.object({ customerId: z.uuid(), booking: NewBooking, waiveFee: z.boolean() }).strict();
const BlockBody = z.object({ blocked: z.boolean(), reason: Reason }).strict();
const TechActionBody = z.object({ action: z.enum(['approve', 'reject', 'suspend', 'reinstate', 'offline']), reason: Reason }).strict();
const PayoutState = z.object({ state: z.enum(['PENDING', 'PAID', 'FAILED']).default('PENDING') });
const PaidBody = z.object({ reference: z.string().trim().min(3).max(80) }).strict();

function actor(admin: SignedInAdmin, req: FastifyRequest): AdminActor {
  return { type: 'ADMIN', id: admin.id, ip: requester(req).ip };
}

@Controller('admin')
@Public()
@UseGuards(AdminHostGuard, AdminGuard)
export class AdminManageController {
  constructor(
    private readonly bookings: AdminBookingsService,
    private readonly people: AdminPeopleService,
    private readonly addresses: AddressesService,
    private readonly catalog: CatalogService,
    private readonly payoutAccounts: PayoutAccountsService,
  ) {}

  // ---------- bookings ----------

  @Get('bookings')
  listBookings(@Query(new ZodValidationPipe(BookingList)) q: z.infer<typeof BookingList>): Promise<{ rows: AdminBookingRow[]; total: number }> {
    return this.bookings.list(q);
  }

  @Get('bookings/:id')
  booking(@Param('id') id: string): Promise<AdminBookingDetail> {
    return this.bookings.detail(id);
  }

  @Post('bookings')
  @HttpCode(201)
  createBooking(@CurrentAdmin() admin: SignedInAdmin, @Req() req: FastifyRequest, @Body(new ZodValidationPipe(CreateBody)) body: z.infer<typeof CreateBody>): Promise<{ id: string; code: string }> {
    return this.bookings.create(body.customerId, body.booking, body.waiveFee, actor(admin, req));
  }

  @Post('bookings/:id/cancel')
  @HttpCode(204)
  cancel(@CurrentAdmin() admin: SignedInAdmin, @Req() req: FastifyRequest, @Param('id') id: string, @Body(new ZodValidationPipe(CancelBody)) body: z.infer<typeof CancelBody>): Promise<void> {
    return this.bookings.cancel(id, body.refund, body.note, actor(admin, req));
  }

  @Post('bookings/:id/send-back')
  @HttpCode(204)
  sendBack(@CurrentAdmin() admin: SignedInAdmin, @Req() req: FastifyRequest, @Param('id') id: string): Promise<void> {
    return this.bookings.sendBack(id, actor(admin, req));
  }

  @Post('bookings/:id/assign')
  @HttpCode(204)
  assign(@CurrentAdmin() admin: SignedInAdmin, @Req() req: FastifyRequest, @Param('id') id: string, @Body(new ZodValidationPipe(AssignBody)) body: z.infer<typeof AssignBody>): Promise<void> {
    return this.bookings.assign(id, body.technicianId, actor(admin, req));
  }

  @Post('bookings/:id/complete')
  @HttpCode(204)
  complete(@CurrentAdmin() admin: SignedInAdmin, @Req() req: FastifyRequest, @Param('id') id: string): Promise<void> {
    return this.bookings.complete(id, actor(admin, req));
  }

  @Post('bookings/:id/waive-fee')
  @HttpCode(204)
  waive(@CurrentAdmin() admin: SignedInAdmin, @Req() req: FastifyRequest, @Param('id') id: string): Promise<void> {
    return this.bookings.waiveVisitFee(id, actor(admin, req));
  }

  @Post('bookings/:id/erase')
  @HttpCode(204)
  erase(@CurrentAdmin() admin: SignedInAdmin, @Req() req: FastifyRequest, @Param('id') id: string): Promise<void> {
    return this.bookings.erase(id, actor(admin, req));
  }

  @Get('catalog')
  async services(): Promise<{ id: string; categoryId: string; name: string; visitFee: number; issues: { id: string; name: string }[] }[]> {
    return (await this.catalog.services()).map((s) => ({ id: s.id, categoryId: s.categoryId, name: s.name.en, visitFee: s.visitFee, issues: s.issues.map((i) => ({ id: i.id, name: i.name.en })) }));
  }

  // ---------- customers and technicians ----------

  @Get('customers')
  customers(@Query(new ZodValidationPipe(PeopleList)) q: z.infer<typeof PeopleList>): Promise<{ rows: PersonRow[]; total: number }> {
    return this.people.list('CUSTOMER', q);
  }

  @Get('technicians')
  technicians(@Query(new ZodValidationPipe(PeopleList)) q: z.infer<typeof PeopleList>): Promise<{ rows: PersonRow[]; total: number }> {
    return this.people.list('TECHNICIAN', q);
  }

  @Get('people/:id')
  person(@Param('id') id: string): Promise<PersonDetail> {
    return this.people.detail(id);
  }

  @Get('customers/:id/addresses')
  async customerAddresses(@Param('id') id: string): Promise<AddressDto[]> {
    await this.people.detail(id);
    return this.addresses.list(id);
  }

  @Post('people/:id/block')
  @HttpCode(204)
  block(@CurrentAdmin() admin: SignedInAdmin, @Req() req: FastifyRequest, @Param('id') id: string, @Body(new ZodValidationPipe(BlockBody)) body: z.infer<typeof BlockBody>): Promise<void> {
    return this.people.block(id, body.blocked, body.reason, actor(admin, req));
  }

  @Post('people/:id/sign-out')
  @HttpCode(200)
  async signOut(@CurrentAdmin() admin: SignedInAdmin, @Req() req: FastifyRequest, @Param('id') id: string): Promise<{ sessions: number }> {
    return { sessions: await this.people.signOutEverywhere(id, actor(admin, req)) };
  }

  @Post('people/:id/delete')
  @HttpCode(204)
  deletePerson(@CurrentAdmin() admin: SignedInAdmin, @Req() req: FastifyRequest, @Param('id') id: string): Promise<void> {
    return this.people.delete(id, actor(admin, req));
  }

  @Post('technicians/:id/action')
  @HttpCode(204)
  techAction(@CurrentAdmin() admin: SignedInAdmin, @Req() req: FastifyRequest, @Param('id') id: string, @Body(new ZodValidationPipe(TechActionBody)) body: z.infer<typeof TechActionBody>): Promise<void> {
    return this.people.techAction(id, body.action as TechAction, body.reason, actor(admin, req));
  }

  // ---------- payouts ----------

  @Get('payouts')
  payouts(@Query(new ZodValidationPipe(PayoutState)) q: z.infer<typeof PayoutState>): Promise<PayoutRow[]> {
    return this.people.payouts(q.state);
  }

  @Post('payouts/prepare')
  @HttpCode(200)
  prepare(@CurrentAdmin() admin: SignedInAdmin, @Req() req: FastifyRequest): Promise<PayoutRow[]> {
    return this.people.preparePayouts(actor(admin, req));
  }

  /** The bulk-transfer files for the bank, for every payout waiting to be paid (payout kit). Audited. */
  @Post('payouts/bank-files')
  @HttpCode(200)
  bankFiles(@CurrentAdmin() admin: SignedInAdmin, @Req() req: FastifyRequest): Promise<BankFilesDto> {
    const by = actor(admin, req);
    return this.payoutAccounts.bankFiles({ id: by.id, via: `hq:${by.ip}` });
  }

  @Post('payouts/:id/paid')
  @HttpCode(200)
  paid(@CurrentAdmin() admin: SignedInAdmin, @Req() req: FastifyRequest, @Param('id') id: string, @Body(new ZodValidationPipe(PaidBody)) body: z.infer<typeof PaidBody>): Promise<PayoutRow> {
    return this.people.payoutPaid(id, body.reference, actor(admin, req));
  }

  @Post('payouts/:id/failed')
  @HttpCode(200)
  failed(@CurrentAdmin() admin: SignedInAdmin, @Req() req: FastifyRequest, @Param('id') id: string): Promise<PayoutRow> {
    return this.people.payoutFailed(id, actor(admin, req));
  }
}
