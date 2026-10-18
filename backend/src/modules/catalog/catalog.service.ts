import { Injectable } from '@nestjs/common';
import type { Category, CategoryId, Service, ServiceIssue } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { paiseToRupees } from '../../common/money';
import { PrismaService } from '../../common/prisma/prisma.module';

interface Localized {
  readonly en: string;
  readonly te: string;
}

/** openapi.yaml Category. */
export interface CategoryDto {
  readonly id: CategoryId;
  readonly name: Localized;
  readonly tagline: Localized;
  readonly art: string;
  readonly wash: string;
}

/** openapi.yaml Service. The typical maximum is internal (price check) and not exposed. */
export interface ServiceDto {
  readonly id: string;
  readonly categoryId: CategoryId;
  readonly name: Localized;
  readonly description: Localized;
  readonly visitFee: number;
  readonly repairFrom: number;
  readonly durationMin: readonly [number, number];
  readonly rating: number;
  readonly reviews: number;
  readonly issues: readonly { readonly id: string; readonly name: Localized }[];
  readonly keywords: readonly string[];
  readonly popular: boolean;
}

const withIssues = { issues: { orderBy: { sort: 'asc' } } } as const;

function toCategory(c: Category): CategoryDto {
  return { id: c.id, name: { en: c.nameEn, te: c.nameTe }, tagline: { en: c.taglineEn, te: c.taglineTe }, art: c.art, wash: c.wash };
}

function toService(s: Service & { issues: ServiceIssue[] }): ServiceDto {
  return {
    id: s.id,
    categoryId: s.categoryId,
    name: { en: s.nameEn, te: s.nameTe },
    description: { en: s.descriptionEn, te: s.descriptionTe },
    visitFee: paiseToRupees(s.visitFeePaise),
    repairFrom: paiseToRupees(s.repairFromPaise),
    durationMin: [s.durationMin, s.durationMax],
    rating: s.rating,
    reviews: s.reviews,
    issues: s.issues.map((i) => ({ id: i.id, name: { en: i.nameEn, te: i.nameTe } })),
    keywords: s.keywords,
    popular: s.popular,
  };
}

/** Read-only catalog, in the app's order. Only active services are listed or found. */
@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async categories(): Promise<CategoryDto[]> {
    const rows = await this.prisma.category.findMany({ orderBy: { sort: 'asc' } });
    return rows.map(toCategory);
  }

  async services(categoryId?: CategoryId): Promise<ServiceDto[]> {
    const rows = await this.prisma.service.findMany({
      where: { active: true, ...(categoryId ? { categoryId } : {}) },
      orderBy: { sort: 'asc' },
      include: withIssues,
    });
    return rows.map(toService);
  }

  async service(id: string): Promise<ServiceDto> {
    const row = await this.prisma.service.findFirst({ where: { id, active: true }, include: withIssues });
    if (!row) throw new AppError('NOT_FOUND');
    return toService(row);
  }
}
