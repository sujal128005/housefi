import { Module } from '@nestjs/common';
import { PlacesModule } from '../places/places.module';
import { TechVerificationService } from './tech-verification.service';
import { TechniciansController } from './technicians.controller';
import { TechniciansService } from './technicians.service';

/** Depends only on global infrastructure (database, crypto, clock, audit) and the places directory, so the CLI can load it without the API. */
@Module({ imports: [PlacesModule], controllers: [TechniciansController], providers: [TechniciansService, TechVerificationService], exports: [TechniciansService, TechVerificationService] })
export class TechniciansModule {}
