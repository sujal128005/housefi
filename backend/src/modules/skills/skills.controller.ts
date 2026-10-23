import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import type { z } from 'zod';
import { RateLimit } from '../../common/rate-limit/rate-limit.guard';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.guard';
import { ExamAnswerBody, ExamStartBody, SectionIndex, SkillCertificateBody, SkillLevelBody, SkillVideoBody } from './skills.schemas';
import { type ExamDto, type SkillCheckDto, SkillsService } from './skills.service';

/** The technician's skill check: level, exams, work video, certificates, and sending it for review. */
@Controller('tech/skills')
@Roles('TECHNICIAN')
export class SkillsController {
  constructor(private readonly skills: SkillsService) {}

  @Get()
  overview(@CurrentUser() user: AuthUser): Promise<SkillCheckDto> {
    return this.skills.overview(user.id);
  }

  @Put('level')
  level(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(SkillLevelBody)) body: z.infer<typeof SkillLevelBody>): Promise<SkillCheckDto> {
    return this.skills.setLevel(user.id, body.level);
  }

  @Post('exams')
  @HttpCode(200)
  @RateLimit({ limit: 10, windowSec: 60 })
  startExam(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(ExamStartBody)) body: z.infer<typeof ExamStartBody>): Promise<ExamDto> {
    return this.skills.startExam(user.id, body.categoryId);
  }

  @Get('exams/:id')
  exam(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<ExamDto> {
    return this.skills.exam(user.id, id);
  }

  @Post('exams/:id/sections/:index/start')
  @HttpCode(200)
  startSection(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('index', new ZodValidationPipe(SectionIndex)) index: number): Promise<ExamDto> {
    return this.skills.startSection(user.id, id, index);
  }

  @Put('exams/:id/answers/:questionId')
  @RateLimit({ limit: 120, windowSec: 60 })
  answer(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('questionId') questionId: string,
    @Body(new ZodValidationPipe(ExamAnswerBody)) body: z.infer<typeof ExamAnswerBody>,
  ): Promise<ExamDto> {
    return this.skills.answer(user.id, id, questionId, body.optionId);
  }

  @Post('exams/:id/left-app')
  @HttpCode(200)
  leftApp(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<ExamDto> {
    return this.skills.leftApp(user.id, id);
  }

  @Post('exams/:id/submit')
  @HttpCode(200)
  submitExam(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<ExamDto> {
    return this.skills.submitExam(user.id, id);
  }

  @Post('video')
  @HttpCode(200)
  @RateLimit({ limit: 10, windowSec: 60 })
  video(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(SkillVideoBody)) body: z.infer<typeof SkillVideoBody>): Promise<SkillCheckDto> {
    return this.skills.addVideo(user.id, body);
  }

  @Post('certificates')
  @HttpCode(200)
  @RateLimit({ limit: 10, windowSec: 60 })
  certificate(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(SkillCertificateBody)) body: z.infer<typeof SkillCertificateBody>): Promise<SkillCheckDto> {
    return this.skills.addCertificate(user.id, body);
  }

  @Delete('certificates/:id')
  removeCertificate(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<SkillCheckDto> {
    return this.skills.removeCertificate(user.id, id);
  }

  @Post('submit')
  @HttpCode(200)
  submit(@CurrentUser() user: AuthUser): Promise<SkillCheckDto> {
    return this.skills.submit(user.id);
  }
}
