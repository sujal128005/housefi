import { type DynamicModule, Global, Inject, Module } from '@nestjs/common';
import type { Env } from './env';

export const APP_CONFIG = Symbol('APP_CONFIG');

/** Injects the validated environment: `constructor(@InjectConfig() private readonly config: Env)`. */
export const InjectConfig = (): ParameterDecorator => Inject(APP_CONFIG);

@Global()
@Module({})
export class ConfigModule {
  static forRoot(config: Env): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: APP_CONFIG, useValue: Object.freeze(config) }],
      exports: [APP_CONFIG],
    };
  }
}
