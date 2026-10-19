// The portal's operations API: SOS, reports, queries (call-backs and live conversations), booking chats, analytics,
// the audit log, the arcade, and Sarathi (the guide). Signed-in admins only, on the portal's secret host only.
import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { Public } from '../auth/auth.guard';
import type { SignedInAdmin } from './admin-auth.service';
import type { AdminActor } from './admin-bookings.service';
import { type AnalyticsDto, AdminOpsService, type TicketDto } from './admin-ops.service';
import { AdminGuard, AdminHostGuard, CurrentAdmin, requester } from './admin.guard';
import type { GuidePhoto } from './guide/guide-model';
import { type GuideReplyDto, GuideService, type ProposalDto } from './guide/guide.service';

const Group = z.object({ state: z.enum(['OPEN', 'RESOLVED']).default('OPEN') });
const ThreadState = z.object({ state: z.enum(['OPEN', 'CLOSED']).default('OPEN') });
const NoteBody = z.object({ note: z.string().trim().min(3).max(300) }).strict();
const TextBody = z.object({ text: z.string().trim().min(1).max(1000) }).strict();
const CleanupBody = z.object({ days: z.number().int().min(1).max(365) }).strict();
const UnlockBody = z.object({ code: z.string().trim().min(4).max(20) }).strict();
const AnalyticsQuery = z.object({ days: z.coerce.number().int().min(7).max(365).default(30), demo: z.enum(['0', '1']).default('0') });
const AuditQuery = z.object({ search: z.string().max(60).optional(), actor: z.string().max(20).optional(), before: z.coerce.number().int().positive().optional() });
const ScoreBody = z.object({ game: z.string().regex(/^[a-z-]{2,30}$/), score: z.number().int().min(0).max(10_000_000), detail: z.string().max(60).default('') }).strict();
const PHOTO = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;
const GuideBody = z
  .object({ message: z.string().max(4000).default(''), photo: z.string().max(1_900_000).regex(PHOTO).nullable().optional() })
  .strict();
const ApproveBody = z.object({ typed: z.string().max(200).optional(), typedAgain: z.string().max(200).optional(), passkey: z.record(z.string(), z.unknown()).optional() }).strict();

function actor(admin: SignedInAdmin, req: FastifyRequest): AdminActor {
  return { type: 'ADMIN', id: admin.id, ip: requester(req).ip };
}

@Controller('admin')
@Public()
@UseGuards(AdminHostGuard, AdminGuard)
export class AdminOpsController {
  constructor(
    private readonly ops: AdminOpsService,
    private readonly guide: GuideService,
  ) {}

  // ---------- attention ----------

  @Get('alerts')
  alerts(): Promise<{ sos: number; newestSosAt: number | null; reports: number; queries: number; conversations: number }> {
    return this.ops.alerts();
  }

  @Get('tickets/sos')
  sos(@Query(new ZodValidationPipe(Group)) q: z.infer<typeof Group>): Promise<TicketDto[]> {
    return this.ops.tickets('SOS', q.state);
  }

  @Get('tickets/reports')
  reports(@Query(new ZodValidationPipe(Group)) q: z.infer<typeof Group>): Promise<TicketDto[]> {
    return this.ops.tickets('REPORTS', q.state);
  }

  @Get('tickets/queries')
  queries(@Query(new ZodValidationPipe(Group)) q: z.infer<typeof Group>): Promise<TicketDto[]> {
    return this.ops.tickets('QUERIES', q.state);
  }

  @Get('tickets/:id')
  ticket(@Param('id') id: string): Promise<TicketDto> {
    return this.ops.ticket(id);
  }

  @Post('tickets/:id/take')
  @HttpCode(204)
  take(@CurrentAdmin() admin: SignedInAdmin, @Req() req: FastifyRequest, @Param('id') id: string): Promise<void> {
    return this.ops.takeTicket(id, actor(admin, req));
  }

  @Post('tickets/:id/resolve')
  @HttpCode(204)
  resolve(@CurrentAdmin() admin: SignedInAdmin, @Req() req: FastifyRequest, @Param('id') id: string, @Body(new ZodValidationPipe(NoteBody)) body: z.infer<typeof NoteBody>): Promise<void> {
    return this.ops.resolveTicket(id, body.note, actor(admin, req));
  }

  @Post('start-code/unlock')
  @HttpCode(200)
  unlock(@CurrentAdmin() admin: SignedInAdmin, @Req() req: FastifyRequest, @Body(new ZodValidationPipe(UnlockBody)) body: z.infer<typeof UnlockBody>): Promise<{ code: string; ticketsResolved: number }> {
    return this.ops.unlockStart(body.code, actor(admin, req));
  }

  // ---------- live conversations ----------

  @Get('conversations')
  conversations(@Query(new ZodValidationPipe(ThreadState)) q: z.infer<typeof ThreadState>) {
    return this.ops.conversations(q.state);
  }

  @Get('conversations/:id')
  conversation(@Param('id') id: string) {
    return this.ops.conversation(id);
  }

  @Post('conversations/:id/reply')
  @HttpCode(204)
  reply(@CurrentAdmin() admin: SignedInAdmin, @Req() req: FastifyRequest, @Param('id') id: string, @Body(new ZodValidationPipe(TextBody)) body: z.infer<typeof TextBody>): Promise<void> {
    return this.ops.reply(id, body.text, actor(admin, req));
  }

  @Post('conversations/:id/close')
  @HttpCode(204)
  close(@CurrentAdmin() admin: SignedInAdmin, @Req() req: FastifyRequest, @Param('id') id: string): Promise<void> {
    return this.ops.closeConversation(id, actor(admin, req));
  }

  @Post('conversations/:id/delete')
  @HttpCode(204)
  deleteConversation(@CurrentAdmin() admin: SignedInAdmin, @Req() req: FastifyRequest, @Param('id') id: string): Promise<void> {
    return this.ops.deleteConversation(id, actor(admin, req));
  }

  @Post('conversations/cleanup')
  @HttpCode(200)
  async cleanup(@CurrentAdmin() admin: SignedInAdmin, @Req() req: FastifyRequest, @Body(new ZodValidationPipe(CleanupBody)) body: z.infer<typeof CleanupBody>): Promise<{ deleted: number }> {
    return { deleted: await this.ops.cleanupConversations(body.days, actor(admin, req)) };
  }

  // ---------- booking chats ----------

  @Get('chats')
  chats() {
    return this.ops.bookingChats();
  }

  @Get('chats/:bookingId')
  chat(@CurrentAdmin() admin: SignedInAdmin, @Req() req: FastifyRequest, @Param('bookingId') id: string) {
    return this.ops.bookingChat(id, actor(admin, req));
  }

  @Post('chats/:bookingId/delete')
  @HttpCode(204)
  deleteChat(@CurrentAdmin() admin: SignedInAdmin, @Req() req: FastifyRequest, @Param('bookingId') id: string): Promise<void> {
    return this.ops.deleteBookingChat(id, actor(admin, req));
  }

  // ---------- insight ----------

  @Get('analytics')
  analytics(@Query(new ZodValidationPipe(AnalyticsQuery)) q: z.infer<typeof AnalyticsQuery>): Promise<AnalyticsDto> {
    return this.ops.analytics(q.days, q.demo === '1');
  }

  @Get('audit')
  audit(@Query(new ZodValidationPipe(AuditQuery)) q: z.infer<typeof AuditQuery>) {
    return this.ops.auditLog(q);
  }

  // ---------- arcade ----------

  @Post('arcade/scores')
  @HttpCode(200)
  score(@CurrentAdmin() admin: SignedInAdmin, @Body(new ZodValidationPipe(ScoreBody)) body: z.infer<typeof ScoreBody>): Promise<{ best: number; rank: number }> {
    return this.ops.saveScore(admin.id, body.game, body.score, body.detail);
  }

  @Get('arcade/scores/:game')
  leaderboard(@Param('game') game: string) {
    return this.ops.leaderboard(game);
  }

  // ---------- Sarathi, the guide ----------

  @Get('guide')
  guideConversation(@CurrentAdmin() admin: SignedInAdmin) {
    return this.guide.conversation(admin);
  }

  @Post('guide/messages')
  @HttpCode(200)
  ask(@CurrentAdmin() admin: SignedInAdmin, @Req() req: FastifyRequest, @Body(new ZodValidationPipe(GuideBody)) body: z.infer<typeof GuideBody>): Promise<GuideReplyDto> {
    const m = body.photo ? PHOTO.exec(body.photo) : null;
    const photo: GuidePhoto | null = m ? { mediaType: m[1] as GuidePhoto['mediaType'], base64: m[2]! } : null;
    return this.guide.ask(admin, body.message, photo, requester(req).ip);
  }

  @Post('guide/clear')
  @HttpCode(204)
  clearGuide(@CurrentAdmin() admin: SignedInAdmin): Promise<void> {
    return this.guide.clear(admin);
  }

  @Post('guide/actions/:id/step-up')
  @HttpCode(200)
  async stepUp(@CurrentAdmin() admin: SignedInAdmin, @Param('id') id: string): Promise<{ options: unknown }> {
    return { options: await this.guide.stepUp(admin, id) };
  }

  @Post('guide/actions/:id/approve')
  @HttpCode(200)
  approve(@CurrentAdmin() admin: SignedInAdmin, @Req() req: FastifyRequest, @Param('id') id: string, @Body(new ZodValidationPipe(ApproveBody)) body: z.infer<typeof ApproveBody>): Promise<ProposalDto> {
    return this.guide.approve(admin, id, body, requester(req));
  }

  @Post('guide/actions/:id/reject')
  @HttpCode(200)
  reject(@CurrentAdmin() admin: SignedInAdmin, @Req() req: FastifyRequest, @Param('id') id: string): Promise<ProposalDto> {
    return this.guide.reject(admin, id, requester(req).ip);
  }
}
