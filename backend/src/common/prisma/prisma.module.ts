import { Global, Injectable, Module, type OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { InjectConfig } from '../../config/config.module';
import type { Env } from '../../config/env';

/** Database client. Connects lazily on the first query, so the API can start while Postgres is still coming up. */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@InjectConfig() config: Env) {
    // The validated config is the source of truth, not whatever DATABASE_URL happens to be in process.env.
    super({ datasources: { db: { url: config.DATABASE_URL } } });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
