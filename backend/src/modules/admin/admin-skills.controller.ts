// The portal's skill check page: who is waiting, each technician's exams, work video and certificates, and the
// decisions. Signed-in admins only, on the portal's secret host only.
import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { Public } from '../auth/auth.guard';
import { type SkillDetail, type SkillQueueRow, SkillsReviewService } from '../skills/skills-review.service';
import { CertificateDecisionBody, SkillQueueQuery, TradeDecisionBody, VideoDecisionBody } from '../skills/skills.schemas';
import type { SignedInAdmin } from './admin-auth.service';
import { AdminGuard, AdminHostGuard, CurrentAdmin, requester } from './admin.guard';

@Controller('admin/skills')
@Public()
@UseGuards(AdminHostGuard, AdminGuard)
export class AdminSkillsController {
  constructor(private readonly review: SkillsReviewService) {}

  @Get()
  queue(@Query(new ZodValidationPipe(SkillQueueQuery)) q: z.infer<typeof SkillQueueQuery>): Promise<SkillQueueRow[]> {
    return this.review.queue(q.state);
  }

  @Get(':technicianId')
  detail(@Param('technicianId') id: string): Promise<SkillDetail> {
    return this.review.detail(id);
  }

  @Post('videos/:id')
  @HttpCode(204)
  video(@CurrentAdmin() admin: SignedInAdmin, @Req() req: FastifyRequest, @Param('id') id: string, @Body(new ZodValidationPipe(VideoDecisionBody)) body: z.infer<typeof VideoDecisionBody>): Promise<void> {
    return this.review.decideVideo(id, body.decision, body.categoryIds, body.note, { id: admin.id, ip: requester(req).ip });
  }

  @Post('certificates/:id')
  @HttpCode(204)
  certificate(@CurrentAdmin() admin: SignedInAdmin, @Req() req: FastifyRequest, @Param('id') id: string, @Body(new ZodValidationPipe(CertificateDecisionBody)) body: z.infer<typeof CertificateDecisionBody>): Promise<void> {
    return this.review.decideCertificate(id, body.decision, body.note, { id: admin.id, ip: requester(req).ip });
  }

  @Post(':technicianId/trades')
  @HttpCode(204)
  trade(@CurrentAdmin() admin: SignedInAdmin, @Req() req: FastifyRequest, @Param('technicianId') id: string, @Body(new ZodValidationPipe(TradeDecisionBody)) body: z.infer<typeof TradeDecisionBody>): Promise<void> {
    return this.review.decideTrade(id, body.categoryId, body.verified, body.note, { id: admin.id, ip: requester(req).ip });
  }
}
