import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import { type Clock, InjectClock } from '../../common/clock';
import { AppError } from '../../common/errors/app-error';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { Public } from '../auth/auth.guard';
import { type CategoryDto, CatalogService, type GreetingDto, type ServiceDto } from './catalog.service';

const ServicesQuery = z.object({ categoryId: z.enum(['PLUMBING', 'ELECTRICAL', 'AC', 'APPLIANCE', 'CLEANING', 'CARPENTRY']).optional() });
const ServiceParam = z.string().regex(/^[a-z0-9-]{1,40}$/);

/** Public and the same for everyone, so clients and CDNs may cache it briefly. */
const CACHE = 'public, max-age=300';

@Controller('catalog')
@Public()
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    @InjectClock() private readonly clock: Clock,
  ) {}

  /** The festive greeting for the home screens today, or null on ordinary days. Short cache: a coupon made in HQ shows soon. */
  @Get('greeting')
  @Header('cache-control', CACHE)
  greeting(): Promise<GreetingDto | null> {
    return this.catalog.greeting(this.clock.now());
  }

  @Get('categories')
  @Header('cache-control', CACHE)
  categories(): Promise<CategoryDto[]> {
    return this.catalog.categories();
  }

  @Get('services')
  @Header('cache-control', CACHE)
  services(@Query(new ZodValidationPipe(ServicesQuery)) query: z.infer<typeof ServicesQuery>): Promise<ServiceDto[]> {
    return this.catalog.services(query.categoryId);
  }

  @Get('services/:serviceId')
  @Header('cache-control', CACHE)
  service(@Param('serviceId') serviceId: string): Promise<ServiceDto> {
    // Anything that cannot be a service id is simply not found.
    if (!ServiceParam.safeParse(serviceId).success) throw new AppError('NOT_FOUND');
    return this.catalog.service(serviceId);
  }
}
