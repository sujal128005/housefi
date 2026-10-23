import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { RateLimit } from '../../common/rate-limit/rate-limit.guard';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.guard';
import { type CourseDto, type CourseOrderDto, type CoursesDto, CoursesService, type LessonDto, type QuizDto, type QuizResultDto } from './courses.service';

/** openapi.yaml CoursePaymentVerify: what the checkout page returned. */
export const CourseVerifyBody = z
  .object({ razorpayOrderId: z.string().min(1).max(100), razorpayPaymentId: z.string().min(1).max(100), razorpaySignature: z.string().min(1).max(200) })
  .strict();
/** openapi.yaml LessonProgressInput: where the player is, in seconds. */
export const ProgressBody = z.object({ positionSec: z.number().min(0).max(24 * 3600) }).strict();
/** openapi.yaml QuizAnswers: question number → option id. */
export const QuizBody = z.object({ answers: z.record(z.string().regex(/^\d{1,2}$/), z.string().regex(/^[a-f]$/)) }).strict();

/** Courses for technicians: video lessons, a quiz, a certificate. */
@Controller('tech/courses')
@Roles('TECHNICIAN')
export class CoursesController {
  constructor(private readonly courses: CoursesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<CoursesDto> {
    return this.courses.overview(user.id);
  }

  @Get(':courseId')
  detail(@CurrentUser() user: AuthUser, @Param('courseId') id: string): Promise<CourseDto> {
    return this.courses.detail(user.id, id);
  }

  @Post(':courseId/enroll')
  @HttpCode(200)
  enroll(@CurrentUser() user: AuthUser, @Param('courseId') id: string): Promise<CourseDto> {
    return this.courses.enroll(user.id, id);
  }

  @Post(':courseId/payments')
  @HttpCode(200)
  @RateLimit({ limit: 10, windowSec: 60 })
  pay(@CurrentUser() user: AuthUser, @Param('courseId') id: string): Promise<CourseOrderDto> {
    return this.courses.startPayment(user.id, id);
  }

  @Post(':courseId/payments/:paymentId/verify')
  @HttpCode(200)
  verify(
    @CurrentUser() user: AuthUser,
    @Param('courseId') id: string,
    @Param('paymentId') paymentId: string,
    @Body(new ZodValidationPipe(CourseVerifyBody)) body: z.infer<typeof CourseVerifyBody>,
  ): Promise<CourseDto> {
    return this.courses.verifyPayment(user.id, id, paymentId, body);
  }

  @Get(':courseId/lessons/:lessonId')
  lesson(@CurrentUser() user: AuthUser, @Param('courseId') id: string, @Param('lessonId') lessonId: string): Promise<LessonDto> {
    return this.courses.lesson(user.id, id, lessonId);
  }

  @Post(':courseId/lessons/:lessonId/progress')
  @HttpCode(200)
  @RateLimit({ limit: 60, windowSec: 60 })
  progress(
    @CurrentUser() user: AuthUser,
    @Param('courseId') id: string,
    @Param('lessonId') lessonId: string,
    @Body(new ZodValidationPipe(ProgressBody)) body: z.infer<typeof ProgressBody>,
  ): Promise<{ watchedSec: number; completed: boolean }> {
    return this.courses.progress(user.id, id, lessonId, body.positionSec);
  }

  @Get(':courseId/quiz')
  quiz(@CurrentUser() user: AuthUser, @Param('courseId') id: string): Promise<QuizDto> {
    return this.courses.quiz(user.id, id);
  }

  @Post(':courseId/quiz')
  @HttpCode(200)
  @RateLimit({ limit: 10, windowSec: 60 })
  submitQuiz(@CurrentUser() user: AuthUser, @Param('courseId') id: string, @Body(new ZodValidationPipe(QuizBody)) body: z.infer<typeof QuizBody>): Promise<QuizResultDto> {
    return this.courses.submitQuiz(user.id, id, body.answers);
  }
}
