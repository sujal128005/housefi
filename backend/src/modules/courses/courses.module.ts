import { Injectable, Logger, Module, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { InjectConfig } from '../../config/config.module';
import type { Env } from '../../config/env';
import { PaymentsModule } from '../payments/payments.module';
import { CoursesAdminService } from './courses-admin.service';
import { CoursesController } from './courses.controller';
import { CoursesService } from './courses.service';

const EVERY_MS = 5 * 60_000;

/** Asks Razorpay about course orders the app never came back from. */
@Injectable()
export class CoursesWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(CoursesWorker.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly courses: CoursesService,
    @InjectConfig() private readonly config: Env,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.NODE_ENV === 'test') return; // tests call the service directly
    this.timer = setInterval(() => void this.courses.reconcile().catch((e: unknown) => this.log.warn(`course reconcile failed (${(e as Error).message})`)), EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }
}

/** Video courses for technicians (and HQ's side of them, used by the admin portal). */
@Module({ imports: [PaymentsModule], controllers: [CoursesController], providers: [CoursesService, CoursesAdminService, CoursesWorker], exports: [CoursesService, CoursesAdminService] })
export class CoursesModule {}
