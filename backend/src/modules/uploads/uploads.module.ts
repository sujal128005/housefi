import { Global, Module } from '@nestjs/common';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import { UploadsWorker } from './uploads.worker';

/** Global: bookings, AI and account deletion use the same checks. Depends only on infrastructure (no cycles). */
@Global()
@Module({ controllers: [UploadsController], providers: [UploadsService, UploadsWorker], exports: [UploadsService] })
export class UploadsModule {}
