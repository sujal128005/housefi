import { Injectable } from '@nestjs/common';
import type { CategoryId } from '@prisma/client';
import { type Clock, InjectClock } from '../../common/clock';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.module';
import { InjectConfig } from '../../config/config.module';
import type { Env } from '../../config/env';
import { type Slot, slotsFor } from './slot-rules';

@Injectable()
export class SlotsService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectConfig() private readonly config: Env,
    @InjectClock() private readonly clock: Clock,
  ) {}

  /**
   * The six windows of `date` for a service. Capacity is per category and PIN area: pass the PIN of the address the
   * customer picked to get that area's FULL windows; without a PIN the default capacity applies.
   */
  async slots(serviceId: string, date: string, pincode?: string): Promise<Slot[]> {
    const service = await this.prisma.service.findFirst({ where: { id: serviceId, active: true }, select: { categoryId: true } });
    if (!service) throw new AppError('NOT_FOUND');
    const capacity = await this.capacity(service.categoryId, pincode);
    const booked = await this.bookedPerWindow(service.categoryId, pincode, date);
    return slotsFor({ date, nowMs: this.clock.now(), capacity, booked });
  }

  async capacity(categoryId: CategoryId, pincode: string | undefined): Promise<number> {
    if (pincode) {
      const row = await this.prisma.slotCapacity.findUnique({ where: { categoryId_pincode: { categoryId, pincode } } });
      if (row) return row.maxPerWindow;
    }
    return this.config.SLOT_CAPACITY_PER_WINDOW;
  }

  /**
   * Bookings holding each window, by start hour. There is no bookings table until step 5, so nothing is booked yet;
   * step 5 replaces this with a count of scheduled bookings that hold a slot (paid or awaiting payment).
   */
  private async bookedPerWindow(_categoryId: CategoryId, _pincode: string | undefined, _date: string): Promise<Map<number, number>> {
    return new Map();
  }
}
