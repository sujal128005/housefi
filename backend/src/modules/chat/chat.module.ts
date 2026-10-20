import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatWorker } from './chat.worker';

/** Chat between a customer and the assigned technician; uses global infrastructure and the uploads service only. */
@Module({ controllers: [ChatController], providers: [ChatService, ChatWorker], exports: [ChatService] })
export class ChatModule {}
