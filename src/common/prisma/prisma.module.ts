import { Global, Injectable, Module, type OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/** Database client. Connects lazily on the first query, so the API can start while Postgres is still coming up. */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
