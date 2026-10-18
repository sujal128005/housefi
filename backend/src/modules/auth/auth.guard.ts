import { type CanActivate, createParamDecorator, type ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../../common/errors/app-error';
import { AccessTokens, type Role } from './access-tokens';
import { SessionCheck } from './session-check';

export interface AuthUser {
  readonly id: string;
  readonly role: Role;
  /** Session (refresh-token family) the access token belongs to. */
  readonly sessionId: string;
  /** When the access token expires (ms): long-lived streams close then, and the app reconnects with a fresh token. */
  readonly tokenExpiresAt: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
    /** For long-lived streams: whether the caller's token and session are still good. */
    stillSignedIn?: () => Promise<boolean>;
  }
}

const PUBLIC_KEY = 'housefi:public';
const ROLES_KEY = 'housefi:roles';

/** No access token needed (auth, catalog, health, provider webhooks). Everything else requires one. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC_KEY, true);

/** Only these roles may call the route. Other signed-in roles get NOT_FOUND (the API never confirms it exists). */
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator => SetMetadata(ROLES_KEY, roles);

/** The signed-in user: `@CurrentUser() user: AuthUser`. */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const user = ctx.switchToHttp().getRequest<FastifyRequest>().user;
  if (!user) throw new AppError('UNAUTHENTICATED');
  return user;
});

/** Global: every route needs `Authorization: Bearer <access token>` unless marked @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: AccessTokens,
    private readonly sessions: SessionCheck,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const header = req.headers.authorization;
    const match = header ? /^Bearer ([A-Za-z0-9_.-]+)$/.exec(header) : null;
    if (!match?.[1]) throw new AppError('UNAUTHENTICATED');
    const claims = this.tokens.verify(match[1]);

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    if (roles && !roles.includes(claims.role)) throw new AppError('NOT_FOUND');
    // Signed out, deleted or blocked: the token stops working now, not when it expires.
    if (!(await this.sessions.isActive(claims.sub, claims.sid))) throw new AppError('UNAUTHENTICATED');
    req.user = { id: claims.sub, role: claims.role, sessionId: claims.sid, tokenExpiresAt: claims.expiresAt };
    const deadline = Date.now() + claims.remainingMs;
    req.stillSignedIn = async () => Date.now() < deadline && (await this.sessions.isActive(claims.sub, claims.sid));
    return true;
  }
}
