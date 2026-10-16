import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { InjectConfig } from '../../config/config.module';
import type { Env } from '../../config/env';
import { RateLimitService } from './rate-limit.service';

const RATE_LIMIT_KEY = 'housefi:rate-limit';

export interface RouteLimit {
  readonly limit: number;
  readonly windowSec: number;
}

/** Per-IP limit for one route or controller, replacing the default (RATE_LIMIT_PER_MIN per minute). */
export const RateLimit = (limit: RouteLimit): MethodDecorator & ClassDecorator => SetMetadata(RATE_LIMIT_KEY, limit);

/** No per-IP limit (health checks, provider webhooks that are verified by signature). */
export const SkipRateLimit = (): MethodDecorator & ClassDecorator => SetMetadata(RATE_LIMIT_KEY, false);

/**
 * Global per-IP limit. Per-phone and per-user limits (OTP, payments) are applied inside the services with
 * RateLimitService, because they need the parsed body or the signed-in user.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limits: RateLimitService,
    @InjectConfig() private readonly config: Env,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const route = this.reflector.getAllAndOverride<RouteLimit | false | undefined>(RATE_LIMIT_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (route === false) return true;
    const { limit, windowSec } = route ?? { limit: this.config.RATE_LIMIT_PER_MIN, windowSec: 60 };
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const scope = route ? `${ctx.getClass().name}.${ctx.getHandler().name}` : 'default';
    await this.limits.consume(`ip:${scope}:${req.ip}`, { limit, windowSec });
    return true;
  }
}
