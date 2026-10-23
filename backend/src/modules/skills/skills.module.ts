import { Module } from '@nestjs/common';
import { TechniciansModule } from '../technicians/technicians.module';
import { SkillsReviewService } from './skills-review.service';
import { SkillsController } from './skills.controller';
import { SkillsService } from './skills.service';

/** The technician's skill check (exams, work video, certificates) and HQ's review of it (used by the admin portal). */
@Module({ imports: [TechniciansModule], controllers: [SkillsController], providers: [SkillsService, SkillsReviewService], exports: [SkillsService, SkillsReviewService] })
export class SkillsModule {}
