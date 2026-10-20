import { Module } from '@nestjs/common';
import { PartsService } from './parts.service';

/** The parts price list (quotes use it; Housefi HQ edits it). Global infrastructure only. */
@Module({ providers: [PartsService], exports: [PartsService] })
export class PartsModule {}
