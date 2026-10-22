import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../../common/errors/app-error';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { Public } from '../auth/auth.guard';
import { type LocalityDto, type NearPlaceDto, type PincodeDto, PlacesService } from './places.service';

const Name = z.string().trim().min(1).max(80);
const StateQuery = z.object({ state: Name });
const DistrictQuery = z.object({ state: Name, district: Name });
const Pincode = z.string().regex(/^[1-9][0-9]{5}$/);
const NearQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  pincode: Pincode.optional(),
  /** Place names from the phone's map lookup, comma-separated ("Kukatpally, Hyderabad"). */
  area: z.string().trim().max(200).optional(),
});

/** India Post's directory changes a few times a year: clients may keep it for a day. */
const CACHE = 'public, max-age=86400';

/** States, districts, localities and PIN codes (India Post's All India Pincode Directory), for address forms. */
@Controller('places')
@Public()
export class PlacesController {
  constructor(private readonly places: PlacesService) {}

  @Get('states')
  @Header('cache-control', CACHE)
  states(): string[] {
    return this.places.states();
  }

  @Get('districts')
  @Header('cache-control', CACHE)
  districts(@Query(new ZodValidationPipe(StateQuery)) q: z.infer<typeof StateQuery>): string[] {
    return this.places.districts(q.state);
  }

  @Get('localities')
  @Header('cache-control', CACHE)
  localities(@Query(new ZodValidationPipe(DistrictQuery)) q: z.infer<typeof DistrictQuery>): LocalityDto[] {
    return this.places.localities(q.state, q.district);
  }

  @Get('pincodes/:pincode')
  @Header('cache-control', CACHE)
  pincode(@Param('pincode') pincode: string): PincodeDto {
    if (!Pincode.safeParse(pincode).success) throw new AppError('NOT_FOUND');
    return this.places.pincode(pincode);
  }

  /** Not cached: it is about where the phone is right now. */
  @Get('near')
  @Header('cache-control', 'no-store')
  near(@Query(new ZodValidationPipe(NearQuery)) q: z.infer<typeof NearQuery>): NearPlaceDto {
    return this.places.near(q.lat, q.lng, q.pincode, q.area);
  }
}
