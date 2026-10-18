import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { isIP } from 'node:net';
import { InjectConfig } from '../../config/config.module';
import type { Env } from '../../config/env';
import { RateLimitService } from './rate-limit.service';

const RATE_LIMIT_KEY = 'housefi:rate-limit';

export interface RouteLimit {
  readonly limit: number;
  readonly windowSec: number;
  /** `closed` for abuse-sensitive routes (sign-in codes): refused while the limit store is down. Default `open`. */
  readonly onStoreError?: 'open' | 'closed';
}

/**
 * The bucket an address is counted in: the address itself for IPv4, its /64 network for IPv6 (one connection
 * usually owns a whole /64, so per-address buckets would be free to multiply).
 */
export function ipBucket(ip: string | undefined): string {
  if (!ip) return 'unknown';
  const v4mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (v4mapped) return v4mapped[1] as string;
  if (isIP(ip) !== 6) return ip;
  const [head = '', tail = ''] = ip.toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
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
    const { limit, windowSec, onStoreError } = route ?? { limit: this.config.RATE_LIMIT_PER_MIN, windowSec: 60 };
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const scope = route ? `${ctx.getClass().name}.${ctx.getHandler().name}` : 'default';
    // On a developer's machine Redis is optional, so sign-in keeps working without it.
    const failMode = this.config.NODE_ENV === 'development' ? 'open' : onStoreError;
    await this.limits.consume(`ip:${scope}:${ipBucket(req.ip)}`, { limit, windowSec, onStoreError: failMode });
    return true;
  }
}
