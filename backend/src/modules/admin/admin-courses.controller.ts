// The portal's courses page: lesson videos (sent straight in the request body, at most 100 MB), publishing, numbers.
// Signed-in admins only, on the portal's secret host only.
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { Public } from '../auth/auth.guard';
import { type AdminCourseDto, CoursesAdminService } from '../courses/courses-admin.service';
import type { SignedInAdmin } from './admin-auth.service';
import { AdminGuard, AdminHostGuard, CurrentAdmin, requester } from './admin.guard';

const PublishBody = z.object({ published: z.boolean() }).strict();

@Controller('admin/courses')
@Public()
@UseGuards(AdminHostGuard, AdminGuard)
export class AdminCoursesController {
  constructor(private readonly courses: CoursesAdminService) {}

  @Get()
  list(): Promise<AdminCourseDto[]> {
    return this.courses.list();
  }

  @Put(':courseId/lessons/:lessonId/video')
  @HttpCode(204)
  upload(@CurrentAdmin() admin: SignedInAdmin, @Req() req: FastifyRequest, @Param('courseId') courseId: string, @Param('lessonId') lessonId: string): Promise<void> {
    return this.courses.uploadVideo(courseId, lessonId, String(req.headers['content-type'] ?? ''), req.body, { id: admin.id, ip: requester(req).ip });
  }

  @Delete(':courseId/lessons/:lessonId/video')
  @HttpCode(204)
  remove(@CurrentAdmin() admin: SignedInAdmin, @Req() req: FastifyRequest, @Param('courseId') courseId: string, @Param('lessonId') lessonId: string): Promise<void> {
    return this.courses.removeVideo(courseId, lessonId, { id: admin.id, ip: requester(req).ip });
  }

  @Post(':courseId/publish')
  @HttpCode(204)
  publish(@CurrentAdmin() admin: SignedInAdmin, @Req() req: FastifyRequest, @Param('courseId') courseId: string, @Body(new ZodValidationPipe(PublishBody)) body: z.infer<typeof PublishBody>): Promise<void> {
    return this.courses.publish(courseId, body.published, { id: admin.id, ip: requester(req).ip });
  }
}
