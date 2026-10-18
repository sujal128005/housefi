import { Module } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module';
import type { Env } from '../../config/env';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsWorker } from './notifications.worker';
import { RemindersService } from './reminders.service';
import { RemindersWorker } from './reminders.worker';
import { ExpoPushSender, LogPushSender, PUSH_SENDER } from './push-sender';

/** The inbox API, push delivery and reminders. Notices are written through the global Notifier (notifier.ts). */
@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsWorker,
    RemindersService,
    RemindersWorker,
    {
      provide: PUSH_SENDER,
      inject: [APP_CONFIG],
      useFactory: (config: Env) => (config.PUSH_PROVIDER === 'expo' ? new ExpoPushSender({ accessToken: config.EXPO_ACCESS_TOKEN }) : new LogPushSender()),
    },
  ],
  exports: [NotificationsService, RemindersService],
})
export class NotificationsModule {}
