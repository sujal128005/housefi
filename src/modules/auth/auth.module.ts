import { Module } from '@nestjs/common';
import { type Clock, CLOCK } from '../../common/clock';
import { APP_CONFIG } from '../../config/config.module';
import type { Env } from '../../config/env';
import { AccessTokens } from './access-tokens';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { SessionsService } from './sessions.service';
import { UsersModule } from '../users/users.module';
import { ConsoleSmsSender, Msg91SmsSender, SMS_SENDER, type SmsSender } from './sms';

function createAccessTokens(config: Env, clock: Clock): AccessTokens {
  if (!config.JWT_PRIVATE_KEY_B64 || !config.JWT_PUBLIC_KEY_B64) {
    throw new Error('JWT_PRIVATE_KEY_B64 and JWT_PUBLIC_KEY_B64 must be set (run "npm run setup" for local development)');
  }
  return new AccessTokens({
    privateKeyB64: config.JWT_PRIVATE_KEY_B64,
    publicKeyB64: config.JWT_PUBLIC_KEY_B64,
    issuer: config.PUBLIC_BASE_URL,
    ttlSec: config.JWT_ACCESS_TTL_SEC,
    now: () => clock.now(),
  });
}

function createSmsSender(config: Env): SmsSender {
  if (config.SMS_PROVIDER === 'msg91') {
    if (!config.MSG91_AUTH_KEY || !config.MSG91_OTP_TEMPLATE_ID) throw new Error('SMS_PROVIDER=msg91 needs MSG91_AUTH_KEY and MSG91_OTP_TEMPLATE_ID');
    return new Msg91SmsSender({ authKey: config.MSG91_AUTH_KEY, templateId: config.MSG91_OTP_TEMPLATE_ID });
  }
  return new ConsoleSmsSender();
}

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [
    { provide: AccessTokens, inject: [APP_CONFIG, CLOCK], useFactory: createAccessTokens },
    { provide: SMS_SENDER, inject: [APP_CONFIG], useFactory: createSmsSender },
    OtpService,
    SessionsService,
    AuthService,
  ],
  exports: [AccessTokens],
})
export class AuthModule {}
