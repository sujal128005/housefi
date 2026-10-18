import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { Roles } from '../auth/auth.guard';
import { isIsoDate, type Slot } from './slot-rules';
import { SlotsService } from './slots.service';

export const SlotsQuery = z.object({
  serviceId: z.string().regex(/^[a-z0-9-]{1,40}$/),
  date: z.string().refine(isIsoDate),
  /** Not in openapi.yaml (additive): the PIN of the chosen address, for that area's capacity. */
  pincode: z.string().regex(/^[1-9][0-9]{5}$/).optional(),
});

@Controller('slots')
@Roles('CUSTOMER')
export class SlotsController {
  constructor(private readonly slots: SlotsService) {}

  @Get()
  list(@Query(new ZodValidationPipe(SlotsQuery)) q: z.infer<typeof SlotsQuery>): Promise<Slot[]> {
    return this.slots.slots(q.serviceId, q.date, q.pincode);
  }
}
