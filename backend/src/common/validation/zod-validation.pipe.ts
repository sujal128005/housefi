import { type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { AppError } from '../errors/app-error';
import type { FieldError } from '../errors/error-codes';

function valueAt(input: unknown, path: readonly PropertyKey[]): unknown {
  let cur: unknown = input;
  for (const key of path) {
    if (typeof cur !== 'object' || cur === null) return undefined;
    cur = (cur as Record<PropertyKey, unknown>)[key];
  }
  return cur;
}

function isMissing(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

/** Zod issues as the contract's `fields` map: `{ "address.pincode": "INVALID", "name": "REQUIRED" }`. */
export function fieldErrors(input: unknown, issues: readonly z.core.$ZodIssue[]): Record<string, FieldError> {
  const fields: Record<string, FieldError> = {};
  for (const issue of issues) {
    if (issue.path.length === 0) continue;
    const key = issue.path.map(String).join('.');
    if (fields[key] === 'REQUIRED') continue;
    fields[key] = isMissing(valueAt(input, issue.path)) ? 'REQUIRED' : 'INVALID';
  }
  return fields;
}

/**
 * Validates and parses a body, query or param against a Zod schema (which mirrors openapi.yaml):
 * `@Body(new ZodValidationPipe(NewBookingSchema)) input: NewBooking`. Failure is `VALIDATION` with `fields`.
 */
export class ZodValidationPipe<S extends z.ZodType> implements PipeTransform<unknown, z.output<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.output<S> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw new AppError('VALIDATION', { fields: fieldErrors(value, result.error.issues) });
  }
}
