import { Global, Inject, Module } from '@nestjs/common';

/** Current time in epoch ms. Injected so tests can move time (OTP expiry, token lifetimes) without waiting. */
export interface Clock {
  now(): number;
}

export const CLOCK = Symbol('CLOCK');

export const InjectClock = (): ParameterDecorator => Inject(CLOCK);

export const systemClock: Clock = { now: () => Date.now() };

@Global()
@Module({ providers: [{ provide: CLOCK, useValue: systemClock }], exports: [CLOCK] })
export class ClockModule {}
