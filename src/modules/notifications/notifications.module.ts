import { Module } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module';
import type { Env } from '../../config/env';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsWorker } from './notifications.worker';
import { ExpoPushSender, LogPushSender, PUSH_SENDER } from './push-sender';

/** The inbox API and push delivery. Notices are written through the global Notifier (notifier.ts). */
@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsWorker,
    {
      provide: PUSH_SENDER,
      inject: [APP_CONFIG],
      useFactory: (config: Env) => (config.PUSH_PROVIDER === 'expo' ? new ExpoPushSender({ accessToken: config.EXPO_ACCESS_TOKEN }) : new LogPushSender()),
    },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
