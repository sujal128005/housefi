import { Injectable } from '@nestjs/common';
import type { Address, AddressLabel, Prisma } from '@prisma/client';
import { type Clock, InjectClock } from '../../common/clock';
import { FieldCipher } from '../../common/crypto/field-cipher';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.module';
import { type AddressInput, deriveLocality } from './addresses.schemas';

/** Saved addresses per customer; more than this is almost certainly abuse. */
export const MAX_ADDRESSES = 20;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** openapi.yaml Address. */
export interface AddressDto {
  readonly id: string;
  readonly label: AddressLabel;
  readonly house: string;
  readonly street: string;
  /** May be "". */
  readonly landmark: string;
  readonly city: string;
  readonly pincode: string;
  readonly lat?: number;
  readonly lng?: number;
}

type Db = Prisma.TransactionClient | PrismaService;

/** Fields removed when an address is deleted (here, and when the whole account is deleted). */
const WIPED = { houseEnc: new Uint8Array(0), streetEnc: new Uint8Array(0), landmarkEnc: null, locality: '' } as const;

@Injectable()
export class AddressesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: FieldCipher,
    @InjectClock() private readonly clock: Clock,
  ) {}

  async list(userId: string): Promise<AddressDto[]> {
    const rows = await this.prisma.address.findMany({ where: { userId, deletedAt: null }, orderBy: { createdAt: 'asc' } });
    return this.toDtos(rows);
  }

  /** One of the customer's own addresses; anyone else's (or a deleted one) is NOT_FOUND. */
  async getOwned(userId: string, id: string): Promise<AddressDto> {
    const row = UUID.test(id) ? await this.prisma.address.findFirst({ where: { id, userId, deletedAt: null } }) : null;
    if (!row) throw new AppError('NOT_FOUND');
    const [dto] = await this.toDtos([row]);
    return dto as AddressDto;
  }

  async create(userId: string, input: AddressInput): Promise<AddressDto> {
    const fields = await this.encrypt(input);
    const id = await this.prisma.$transaction(async (tx) => {
      const count = await tx.address.count({ where: { userId, deletedAt: null } });
      if (count >= MAX_ADDRESSES) throw new AppError('CONFLICT', {}, `at most ${MAX_ADDRESSES} saved addresses`);
      const row = await tx.address.create({ data: { userId, ...fields }, select: { id: true } });
      await this.setLocation(tx, row.id, input);
      return row.id;
    });
    return this.getOwned(userId, id);
  }

  /** Replaces the whole address (PUT). Omitting lat/lng clears the location. */
  async update(userId: string, id: string, input: AddressInput): Promise<AddressDto> {
    await this.getOwned(userId, id);
    const fields = await this.encrypt(input);
    await this.prisma.$transaction(async (tx) => {
      await tx.address.update({ where: { id }, data: fields });
      await this.setLocation(tx, id, input);
    });
    return this.getOwned(userId, id);
  }

  /** Soft delete that also wipes the personal fields; past bookings keep their own copy. No-op if not yours. */
  async remove(userId: string, id: string): Promise<void> {
    if (!UUID.test(id)) return;
    await this.prisma.$transaction(async (tx) => this.wipe(tx, { id, userId }));
  }

  /** For account deletion: wipes every address of the user inside the caller's transaction. */
  async wipeAll(tx: Prisma.TransactionClient, userId: string): Promise<void> {
    await this.wipe(tx, { userId });
  }

  private async wipe(tx: Prisma.TransactionClient, where: { userId: string; id?: string }): Promise<void> {
    const rows = await tx.address.findMany({ where: { ...where, deletedAt: null }, select: { id: true } });
    if (rows.length === 0) return;
    const ids = rows.map((r) => r.id);
    await tx.address.updateMany({ where: { id: { in: ids } }, data: { ...WIPED, deletedAt: new Date(this.clock.now()) } });
    await tx.$executeRaw`UPDATE addresses SET location = NULL WHERE id = ANY(${ids}::uuid[])`;
  }

  private async encrypt(a: AddressInput) {
    return {
      label: a.label,
      houseEnc: await this.cipher.encrypt('addresses.house', a.house),
      streetEnc: await this.cipher.encrypt('addresses.street', a.street),
      landmarkEnc: a.landmark ? await this.cipher.encrypt('addresses.landmark', a.landmark) : null,
      locality: deriveLocality(a.street, a.city),
      city: a.city,
      pincode: a.pincode,
    };
  }

  private async setLocation(db: Db, id: string, a: AddressInput): Promise<void> {
    if (a.lat !== undefined && a.lng !== undefined) {
      await db.$executeRaw`UPDATE addresses SET location = ST_SetSRID(ST_MakePoint(${a.lng}, ${a.lat}), 4326)::geography WHERE id = ${id}::uuid`;
    } else {
      await db.$executeRaw`UPDATE addresses SET location = NULL WHERE id = ${id}::uuid`;
    }
  }

  private async toDtos(rows: Address[]): Promise<AddressDto[]> {
    if (rows.length === 0) return [];
    const coords = await this.prisma.$queryRaw<{ id: string; lat: number; lng: number }[]>`
      SELECT id::text AS id, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
      FROM addresses WHERE id = ANY(${rows.map((r) => r.id)}::uuid[]) AND location IS NOT NULL`;
    const byId = new Map(coords.map((c) => [c.id, c]));
    return Promise.all(
      rows.map(async (r) => {
        const c = byId.get(r.id);
        return {
          id: r.id,
          label: r.label,
          house: await this.cipher.decrypt('addresses.house', r.houseEnc),
          street: await this.cipher.decrypt('addresses.street', r.streetEnc),
          landmark: r.landmarkEnc ? await this.cipher.decrypt('addresses.landmark', r.landmarkEnc) : '',
          city: r.city,
          pincode: r.pincode.trim(),
          ...(c ? { lat: c.lat, lng: c.lng } : {}),
        };
      }),
    );
  }
}
