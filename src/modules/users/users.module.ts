import { Module } from '@nestjs/common';
import { AddressesModule } from '../addresses/addresses.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({ imports: [AddressesModule], controllers: [UsersController], providers: [UsersService], exports: [UsersService] })
export class UsersModule {}
