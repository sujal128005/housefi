import { Module } from '@nestjs/common';
import { SupportChatService } from './support-chat.service';
import { SupportWatchdog, SupportWatchdogWorker } from './support-watchdog';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

/** Depends only on global infrastructure, so the CLI (npm run support) can load it without the API. */
@Module({ controllers: [SupportController], providers: [SupportService, SupportChatService, SupportWatchdog, SupportWatchdogWorker], exports: [SupportService, SupportChatService, SupportWatchdog] })
export class SupportModule {}
