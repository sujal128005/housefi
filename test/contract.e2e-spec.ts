// docs/openapi.yaml and the API agree: every documented route exists, and every route the API serves is documented
// (except the provider webhooks and health checks, which the app never calls).
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { MetadataScanner } from '@nestjs/core';
import type { NestContainer } from '@nestjs/core/injector/container';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildTestApp, requireTestDatabase, type TestApp } from './helpers';

/** Not part of the app contract: called by Exotel, or by load balancers and uptime checks. */
const UNDOCUMENTED = [/^\/webhooks\/telephony\//, /^\/health/];

/** "METHOD /path/{param}" for every operation in openapi.yaml (a small reader: paths are 2-space keys, methods 4-space). */
function documented(): Set<string> {
  const ops = new Set<string>();
  let path: string | null = null;
  for (const line of readFileSync(join(__dirname, '../docs/openapi.yaml'), 'utf8').split('\n')) {
    const p = /^ {2}(\/\S*):\s*$/.exec(line);
    if (p) path = p[1]!;
    else if (/^\S/.test(line)) path = null;
    const m = /^ {4}(get|post|put|patch|delete):/.exec(line);
    if (path && m) ops.add(`${m[1]!.toUpperCase()} ${path}`);
  }
  return ops;
}

const join2 = (...parts: string[]) => `/${parts.flatMap((p) => p.split('/')).filter(Boolean).join('/')}`;

describe('API contract (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    requireTestDatabase();
    t = await buildTestApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  /** "METHOD /path/{param}" for every route the controllers declare. */
  function served(): Set<string> {
    const ops = new Set<string>();
    const scanner = new MetadataScanner();
    const container = (t.app as unknown as { container: NestContainer }).container;
    const wrappers = [...container.getModules().values()].flatMap((m) => [...m.controllers.values()]);
    for (const wrapper of wrappers) {
      const { metatype, instance } = wrapper;
      if (!metatype || !instance) continue;
      const bases = ([] as string[]).concat(Reflect.getMetadata(PATH_METADATA, metatype) ?? '');
      for (const name of scanner.getAllMethodNames(Object.getPrototypeOf(instance))) {
        const handler = (instance as Record<string, unknown>)[name];
        const subPaths = Reflect.getMetadata(PATH_METADATA, handler as object);
        if (subPaths === undefined) continue;
        const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler as object) as RequestMethod];
        for (const base of bases) {
          for (const sub of ([] as string[]).concat(subPaths)) ops.add(`${method} ${join2(base, sub).replace(/:(\w+)/g, '{$1}')}`);
        }
      }
    }
    return ops;
  }

  // Path parameter names may differ ({id} in a controller, {bookingId} in the contract): compare shapes.
  const shape = (op: string) => op.replace(/\{\w+\}/g, '{}');

  it('serves every documented operation', () => {
    const api = new Set([...served()].map(shape));
    const missing = [...documented()].filter((op) => !api.has(shape(op)));
    expect(missing).toEqual([]);
  });

  it('documents every operation it serves', () => {
    const spec = new Set([...documented()].map(shape));
    const undocumented = [...served()].filter((op) => !UNDOCUMENTED.some((re) => re.test(op.split(' ')[1]!)) && !spec.has(shape(op)));
    expect(undocumented).toEqual([]);
  });
});
