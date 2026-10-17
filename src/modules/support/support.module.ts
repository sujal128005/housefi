import { Module } from '@nestjs/common';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

/** Depends only on global infrastructure, so the CLI (npm run support) can load it without the API. */
@Module({ controllers: [SupportController], providers: [SupportService], exports: [SupportService] })
export class SupportModule {}
