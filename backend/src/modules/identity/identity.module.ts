import { Module } from '@nestjs/common';
import { TechniciansModule } from '../technicians/technicians.module';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';

@Module({ imports: [TechniciansModule], controllers: [IdentityController], providers: [IdentityService], exports: [IdentityService] })
export class IdentityModule {}
