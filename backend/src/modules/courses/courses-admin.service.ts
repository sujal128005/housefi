// HQ's side of the courses: every course of the catalogue with its lessons, which lessons have a video, publishing,
// and who took it. A lesson video is sent through the portal (at most 100 MB, the most Cloudflare passes in one
// request; a 10-minute lesson at 720p fits), checked like any upload (really an MP4, its length read from the file,
// recording place removed) and kept in the private bucket. A course can be published only when every lesson has its
// video; removing a video unpublishes the course.
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../../common/audit/audit.module';
import { type Clock, InjectClock } from '../../common/clock';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.module';
import { OBJECT_STORE, type ObjectStore } from '../../common/storage/object-store';
import { isType, mp4DurationSec, stripVideoLocation, type VideoType } from '../uploads/media';
import { COURSES, courseDef, type CourseLevel, type Localized } from './course-catalog';

/** A lesson video, sent through the portal. */
export const MAX_LESSON_VIDEO_BYTES = 100 * 1024 * 1024;
export const MAX_LESSON_VIDEO_SEC = 60 * 60;
const LESSON_VIDEO_TYPES: readonly VideoType[] = ['video/mp4', 'video/quicktime'];

export interface ReviewActor {
  readonly id: string;
  readonly ip: string;
}

export interface AdminCourseDto {
  readonly id: string;
  readonly categoryId: string | null;
  readonly level: CourseLevel;
  readonly title: Localized;
  readonly published: boolean;
  readonly lessons: readonly { readonly id: string; readonly title: Localized; readonly video: { readonly durationSec: number; readonly bytes: number; readonly uploadedAt: number; readonly url: string } | null }[];
  readonly quizQuestions: number;
  readonly stats: { readonly enrolled: number; readonly completed: number; readonly paid: number; readonly revenue: number };
}

@Injectable()
export class CoursesAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    @InjectClock() private readonly clock: Clock,
  ) {}

  async list(): Promise<AdminCourseDto[]> {
    const [videos, published, enrolled, completed, paid] = await Promise.all([
      this.prisma.courseLessonVideo.findMany(),
      this.prisma.coursePublication.findMany({ where: { published: true }, select: { courseId: true } }),
      this.prisma.courseEnrollment.groupBy({ by: ['courseId'], _count: { _all: true } }),
      this.prisma.courseEnrollment.groupBy({ by: ['courseId'], where: { completedAt: { not: null } }, _count: { _all: true } }),
      this.prisma.coursePayment.groupBy({ by: ['courseId'], where: { state: 'PAID' }, _count: { _all: true }, _sum: { amountPaise: true } }),
    ]);
    const isPublished = new Set(published.map((p) => p.courseId));
    const count = (rows: { courseId: string; _count: { _all: number } }[], id: string) => rows.find((r) => r.courseId === id)?._count._all ?? 0;
    return Promise.all(COURSES.map(async (c) => ({
      id: c.id,
      categoryId: c.categoryId,
      level: c.level,
      title: c.title,
      published: isPublished.has(c.id),
      lessons: await Promise.all(c.lessons.map(async (l) => {
        const v = videos.find((x) => x.courseId === c.id && x.lessonId === l.id);
        return { id: l.id, title: l.title, video: v ? { durationSec: v.durationSec, bytes: v.bytes, uploadedAt: v.uploadedAt.getTime(), url: await this.store.presignGet(v.videoKey, 3600) } : null };
      })),
      quizQuestions: c.quiz.length,
      stats: {
        enrolled: count(enrolled, c.id),
        completed: count(completed, c.id),
        paid: paid.find((r) => r.courseId === c.id)?._count._all ?? 0,
        revenue: Number((paid.find((r) => r.courseId === c.id)?._sum.amountPaise ?? 0n) / 100n),
      },
    })));
  }

  /** A lesson's video (replacing any earlier one). */
  async uploadVideo(courseId: string, lessonId: string, contentType: string, body: unknown, by: ReviewActor): Promise<void> {
    this.lesson(courseId, lessonId);
    const type = LESSON_VIDEO_TYPES.find((t) => t === contentType.split(';')[0]?.trim().toLowerCase());
    if (!type || !(body instanceof Buffer) || body.length === 0) throw new AppError('VALIDATION', { fields: { video: 'INVALID' } }, 'send an MP4 or MOV video');
    if (body.length > MAX_LESSON_VIDEO_BYTES) throw new AppError('VALIDATION', { fields: { video: 'INVALID' } }, 'at most 100 MB');
    const bytes = new Uint8Array(body);
    if (!isType(bytes, type)) throw new AppError('VALIDATION', { fields: { video: 'INVALID' } }, 'not an MP4 or MOV video');
    let durationSec: number;
    let checked: Uint8Array;
    try {
      durationSec = mp4DurationSec(bytes);
      checked = stripVideoLocation(bytes);
    } catch {
      throw new AppError('VALIDATION', { fields: { video: 'INVALID' } }, 'the video could not be read');
    }
    if (durationSec < 5 || durationSec > MAX_LESSON_VIDEO_SEC) throw new AppError('VALIDATION', { fields: { video: 'INVALID' } }, 'a lesson is 5 seconds to 60 minutes');
    const key = `courses/${courseId}/${lessonId}/${randomUUID()}`;
    await this.store.put(key, checked, type);
    const old = await this.prisma.courseLessonVideo.findUnique({ where: { courseId_lessonId: { courseId, lessonId } } });
    const now = new Date(this.clock.now());
    await this.prisma.courseLessonVideo.upsert({
      where: { courseId_lessonId: { courseId, lessonId } },
      create: { courseId, lessonId, videoKey: key, contentType: type, bytes: checked.length, durationSec, uploadedById: by.id, uploadedAt: now },
      update: { videoKey: key, contentType: type, bytes: checked.length, durationSec, uploadedById: by.id, uploadedAt: now },
    });
    if (old) await this.store.delete(old.videoKey);
    await this.audit.record({ actorType: 'ADMIN', actorId: by.id, action: 'admin.course_video', entity: 'course', entityId: courseId, after: { lessonId, durationSec, bytes: checked.length }, ip: by.ip });
  }

  /** Removes a lesson's video; the course is unpublished (it is no longer complete). */
  async removeVideo(courseId: string, lessonId: string, by: ReviewActor): Promise<void> {
    this.lesson(courseId, lessonId);
    const old = await this.prisma.courseLessonVideo.findUnique({ where: { courseId_lessonId: { courseId, lessonId } } });
    if (!old) return;
    await this.prisma.$transaction([
      this.prisma.courseLessonVideo.delete({ where: { courseId_lessonId: { courseId, lessonId } } }),
      this.prisma.coursePublication.updateMany({ where: { courseId }, data: { published: false, changedById: by.id, changedAt: new Date(this.clock.now()) } }),
    ]);
    await this.store.delete(old.videoKey);
    await this.audit.record({ actorType: 'ADMIN', actorId: by.id, action: 'admin.course_video_removed', entity: 'course', entityId: courseId, after: { lessonId }, ip: by.ip });
  }

  /** Opens a course to technicians (every lesson needs its video) or closes it. */
  async publish(courseId: string, published: boolean, by: ReviewActor): Promise<void> {
    const c = courseDef(courseId);
    if (!c) throw new AppError('NOT_FOUND');
    if (published) {
      const have = await this.prisma.courseLessonVideo.count({ where: { courseId, lessonId: { in: c.lessons.map((l) => l.id) } } });
      if (have < c.lessons.length) throw new AppError('CONFLICT', {}, 'every lesson needs its video first');
    }
    const now = new Date(this.clock.now());
    await this.prisma.coursePublication.upsert({
      where: { courseId },
      create: { courseId, published, changedById: by.id, changedAt: now },
      update: { published, changedById: by.id, changedAt: now },
    });
    await this.audit.record({ actorType: 'ADMIN', actorId: by.id, action: published ? 'admin.course_published' : 'admin.course_unpublished', entity: 'course', entityId: courseId, ip: by.ip });
  }

  private lesson(courseId: string, lessonId: string): void {
    if (!courseDef(courseId)?.lessons.some((l) => l.id === lessonId)) throw new AppError('NOT_FOUND');
  }
}
