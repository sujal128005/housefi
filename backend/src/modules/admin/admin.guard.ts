// Every super admin route: only for the portal's secret host (anything else, including api.housefi.tech, gets a plain
// 404 as if nothing were here), never cached, and changes only with the portal's own header (a page on another site
// cannot make the browser send one; the SameSite=Strict cookie is the other half of that protection).
import { type CanActivate, createParamDecorator, type ExecutionContext, Injectable } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../../common/errors/app-error';
import { InjectConfig } from '../../config/config.module';
import type { Env } from '../../config/env';
import { AdminAuthService, COOKIE, type Requester, type SignedInAdmin } from './admin-auth.service';

declare module 'fastify' {
  interface FastifyRequest {
    admin?: SignedInAdmin;
  }
}

export const ADMIN_HEADER = 'x-housefi-admin';

/** The cookie's value, from the Cookie header. */
export function adminToken(req: FastifyRequest): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

/** Who is asking: the address Cloudflare saw (the portal is reachable only through the tunnel), and the browser. */
export function requester(req: FastifyRequest): Requester {
  const cf = req.headers['cf-connecting-ip'];
  return { ip: (typeof cf === 'string' && cf) || req.ip, userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300) };
}

/** Sets (or, with an empty token, clears) the session cookie: HttpOnly, Secure, SameSite=Strict, the admin API only. */
export function setAdminCookie(reply: FastifyReply, token: string, maxAgeSec: number): void {
  void reply.header('set-cookie', `${COOKIE}=${token}; Path=/v1/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSec}`);
}

/** The secret host, no caching, and the portal header on every change. Used on all admin routes. */
@Injectable()
export class AdminHostGuard implements CanActivate {
  constructor(@InjectConfig() private readonly config: Env) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const reply = ctx.switchToHttp().getResponse<FastifyReply>();
    const host = String(req.headers.host ?? '').split(':')[0]?.toLowerCase();
    if (!this.config.ADMIN_HOST || host !== this.config.ADMIN_HOST) throw new AppError('NOT_FOUND');
    void reply.header('cache-control', 'no-store');
    void reply.header('x-robots-tag', 'noindex, nofollow');
    if (req.method !== 'GET' && req.headers[ADMIN_HEADER] !== '1') throw new AppError('NOT_FOUND');
    return true;
  }
}

/** A full sign-in (password and passkey). */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly auth: AdminAuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    req.admin = await this.auth.signedIn(adminToken(req));
    return true;
  }
}

/** The signed-in admin: `@CurrentAdmin() admin: SignedInAdmin`. */
export const CurrentAdmin = createParamDecorator((_: unknown, ctx: ExecutionContext): SignedInAdmin => {
  const admin = ctx.switchToHttp().getRequest<FastifyRequest>().admin;
  if (!admin) throw new AppError('UNAUTHENTICATED');
  return admin;
});
