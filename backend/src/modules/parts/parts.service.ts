// The parts price list: standard prices for common parts, per trade, kept in Housefi HQ. Technicians pick parts from
// it while writing a quote; a listed part at (up to 10% over) its listed price is fair by definition, so it does not
// push a quote into review. The starting list below is loaded once per trade when that trade has no parts yet; after
// that HQ owns the prices (the seed never overwrites them).
import { Injectable } from '@nestjs/common';
import type { CategoryId, Part, Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { paiseToRupees } from '../../common/money';
import { PrismaService } from '../../common/prisma/prisma.module';

export interface PartDto {
  readonly id: string;
  readonly categoryId: CategoryId;
  readonly serviceId: string | null;
  readonly name: { readonly en: string; readonly te: string };
  readonly unit: string;
  /** Whole rupees. */
  readonly price: number;
}

export function toPartDto(p: Part): PartDto {
  return { id: p.id, categoryId: p.categoryId, serviceId: p.serviceId, name: { en: p.nameEn, te: p.nameTe }, unit: p.unit, price: paiseToRupees(p.pricePaise) };
}

/** Starting prices (₹, Hyderabad, 2026). Telugu names start as the English ones; HQ can change both. */
const STARTER: Readonly<Record<CategoryId, readonly (readonly [string, string, number])[]>> = {
  PLUMBING: [
    ['Tap cartridge', 'piece', 250], ['Tap (CP brass)', 'piece', 650], ['Tap washer set', 'set', 30], ['Angle valve', 'piece', 280],
    ['Flush tank fitting kit', 'set', 450], ['PVC pipe ½"', 'metre', 60], ['Waste pipe', 'piece', 180], ['Shower head', 'piece', 350],
    ['Health faucet', 'piece', 450], ['Teflon tape', 'roll', 20],
  ],
  ELECTRICAL: [
    ['Switch (6A modular)', 'piece', 60], ['Socket (16A)', 'piece', 140], ['MCB (32A)', 'piece', 280], ['Ceiling fan capacitor', 'piece', 120],
    ['Fan regulator', 'piece', 250], ['LED bulb 9W', 'piece', 90], ['Wire 1.5 sq mm', 'metre', 25], ['Switchboard plate', 'piece', 120],
    ['Doorbell', 'piece', 350], ['LED tube light 20W', 'piece', 350],
  ],
  AC: [
    ['AC gas top-up (R32)', 'kg', 2500], ['AC capacitor', 'piece', 450], ['AC drain pipe', 'metre', 60], ['Copper pipe', 'metre', 650],
    ['AC outdoor stand', 'piece', 900], ['AC remote', 'piece', 450],
  ],
  APPLIANCE: [
    ['Washing machine inlet pipe', 'piece', 350], ['Washing machine drain pump', 'piece', 1200], ['Fridge thermostat', 'piece', 650],
    ['Fridge door gasket', 'piece', 1200], ['Geyser heating element', 'piece', 650], ['Geyser thermostat', 'piece', 450],
    ['RO membrane', 'piece', 1800], ['RO filter set', 'set', 900],
  ],
  CLEANING: [['Cleaning chemicals pack', 'pack', 250], ['Bathroom cleaner', 'litre', 150]],
  CARPENTRY: [
    ['Hinge (pair)', 'pair', 120], ['Door handle', 'piece', 350], ['Tower bolt', 'piece', 90], ['Drawer channel (pair)', 'pair', 350],
    ['Mortise lock', 'piece', 900], ['Screws pack', 'pack', 50], ['Wood adhesive', 'kg', 300],
  ],
};

/** Loads the starting list for each trade that has no parts yet. Returns how many were added. */
export async function seedParts(prisma: Pick<PrismaClient, 'part'>, now = new Date()): Promise<number> {
  let added = 0;
  for (const [categoryId, rows] of Object.entries(STARTER) as [CategoryId, (typeof STARTER)[CategoryId]][]) {
    if (await prisma.part.count({ where: { categoryId } })) continue;
    await prisma.part.createMany({ data: rows.map(([name, unit, rupees], sort) => ({ categoryId, nameEn: name, nameTe: name, unit, pricePaise: BigInt(rupees * 100), sort, updatedAt: now })) });
    added += rows.length;
  }
  return added;
}

@Injectable()
export class PartsService {
  constructor(private readonly prisma: PrismaService) {}

  /** The active parts for a trade (and the given service's own parts), for the technician's quote screen. */
  async forJob(categoryId: CategoryId, serviceId: string | null): Promise<PartDto[]> {
    const rows = await this.prisma.part.findMany({
      where: { categoryId, active: true, OR: [{ serviceId: null }, ...(serviceId ? [{ serviceId }] : [])] },
      orderBy: [{ sort: 'asc' }, { nameEn: 'asc' }],
    });
    return rows.map(toPartDto);
  }

  /**
   * The listed price (paise) of each part a quote names, checked to be an active part of the job's trade. A part
   * that is not (or no longer) listed is a VALIDATION error, so a quote never cites a price it does not have.
   */
  async listedPrices(categoryId: CategoryId, partIds: readonly string[], db: Pick<Prisma.TransactionClient, 'part'> = this.prisma): Promise<Map<string, bigint>> {
    const ids = [...new Set(partIds)];
    if (!ids.length) return new Map();
    const rows = await db.part.findMany({ where: { id: { in: ids }, categoryId, active: true }, select: { id: true, pricePaise: true } });
    if (rows.length !== ids.length) throw new AppError('VALIDATION', { fields: { 'lines.partId': 'INVALID' } }, 'a part is not on the price list for this trade');
    return new Map(rows.map((r) => [r.id, r.pricePaise]));
  }
}
