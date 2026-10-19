import { Module } from '@nestjs/common';
import { TechniciansModule } from '../technicians/technicians.module';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';
import { AutoApproveWorker } from './auto-approve.worker';

@Module({ imports: [TechniciansModule], controllers: [IdentityController], providers: [IdentityService, AutoApproveWorker], exports: [IdentityService] })
export class IdentityModule {}
