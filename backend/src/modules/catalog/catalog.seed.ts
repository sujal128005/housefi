// Loads catalog.data.json (imported from the app with `npm run catalog:import`) into the database.
// Idempotent: run it on every deploy. Services that disappear from the data are deactivated, not deleted, because
// bookings keep referring to them; their issues are removed (bookings store issue ids as plain text).
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { rupeesToPaise } from '../../common/money';
import rawCatalog from './catalog.data.json';

/** Typical maximum repair = 4 x repairFrom until real job prices exist (docs/STARTER-PROMPT.md step 3). */
export const TYPICAL_MAX_FACTOR = 4;

const CATEGORY_IDS = ['PLUMBING', 'ELECTRICAL', 'AC', 'APPLIANCE', 'CLEANING', 'CARPENTRY'] as const;
const Localized = z.object({ en: z.string().min(1), te: z.string().min(1) });
const Id = z.string().regex(/^[a-z0-9-]{2,40}$/);

export const CatalogData = z
  .object({
    categories: z
      .array(z.object({ id: z.enum(CATEGORY_IDS), name: Localized, tagline: Localized, art: z.string().min(1), wash: z.string().min(1) }))
      .length(CATEGORY_IDS.length),
    services: z
      .array(
        z.object({
          id: Id,
          categoryId: z.enum(CATEGORY_IDS),
          name: Localized,
          description: Localized,
          visitFee: z.number().int().positive(),
          repairFrom: z.number().int().positive(),
          durationMin: z.tuple([z.number().int().positive(), z.number().int().positive()]).refine(([a, b]) => a <= b),
          rating: z.number().min(0).max(5),
          reviews: z.number().int().min(0),
          popular: z.boolean(),
          issues: z.array(z.object({ id: Id, name: Localized })).min(1),
          keywords: z.array(z.string().min(1)),
        }),
      )
      .min(1),
  })
  .superRefine((d, ctx) => {
    const seen = new Set<string>();
    for (const id of [...d.services.map((s) => s.id), ...d.services.flatMap((s) => s.issues.map((i) => i.id))]) {
      if (seen.has(id)) ctx.addIssue({ code: 'custom', message: `duplicate id ${id}` });
      seen.add(id);
    }
  });

export type CatalogData = z.infer<typeof CatalogData>;

export interface SeedResult {
  readonly categories: number;
  readonly services: number;
  readonly issues: number;
  readonly deactivated: readonly string[];
}

export async function seedCatalog(prisma: PrismaClient, raw: unknown = rawCatalog): Promise<SeedResult> {
  const data = CatalogData.parse(raw);
  return prisma.$transaction(
    async (tx) => {
      for (const [sort, c] of data.categories.entries()) {
        const fields = { nameEn: c.name.en, nameTe: c.name.te, taglineEn: c.tagline.en, taglineTe: c.tagline.te, art: c.art, wash: c.wash, sort };
        await tx.category.upsert({ where: { id: c.id }, create: { id: c.id, ...fields }, update: fields });
      }
      for (const [sort, s] of data.services.entries()) {
        const fields = {
          categoryId: s.categoryId,
          nameEn: s.name.en,
          nameTe: s.name.te,
          descriptionEn: s.description.en,
          descriptionTe: s.description.te,
          visitFeePaise: rupeesToPaise(s.visitFee),
          repairFromPaise: rupeesToPaise(s.repairFrom),
          repairTypicalMaxPaise: rupeesToPaise(s.repairFrom * TYPICAL_MAX_FACTOR),
          durationMin: s.durationMin[0],
          durationMax: s.durationMin[1],
          rating: s.rating,
          reviews: s.reviews,
          keywords: s.keywords,
          popular: s.popular,
          active: true,
          sort,
        };
        await tx.service.upsert({ where: { id: s.id }, create: { id: s.id, ...fields }, update: fields });
        for (const [issueSort, i] of s.issues.entries()) {
          const issue = { serviceId: s.id, nameEn: i.name.en, nameTe: i.name.te, sort: issueSort };
          await tx.serviceIssue.upsert({ where: { id: i.id }, create: { id: i.id, ...issue }, update: issue });
        }
        await tx.serviceIssue.deleteMany({ where: { serviceId: s.id, id: { notIn: s.issues.map((i) => i.id) } } });
      }
      const gone = await tx.service.findMany({ where: { id: { notIn: data.services.map((s) => s.id) }, active: true }, select: { id: true } });
      await tx.service.updateMany({ where: { id: { in: gone.map((g) => g.id) } }, data: { active: false } });
      await tx.serviceIssue.deleteMany({ where: { serviceId: { in: gone.map((g) => g.id) } } });
      return {
        categories: data.categories.length,
        services: data.services.length,
        issues: data.services.reduce((n, s) => n + s.issues.length, 0),
        deactivated: gone.map((g) => g.id),
      };
    },
    { timeout: 30_000 },
  );
}
