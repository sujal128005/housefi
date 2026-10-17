import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.guard';
import { AddressInput } from './addresses.schemas';
import { type AddressDto, AddressesService } from './addresses.service';

/** The signed-in customer's saved addresses. Every query is scoped to the caller. */
@Controller('addresses')
@Roles('CUSTOMER')
export class AddressesController {
  constructor(private readonly addresses: AddressesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<AddressDto[]> {
    return this.addresses.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(AddressInput)) input: AddressInput): Promise<AddressDto> {
    return this.addresses.create(user.id, input);
  }

  @Put(':addressId')
  update(
    @CurrentUser() user: AuthUser,
    @Param('addressId') id: string,
    @Body(new ZodValidationPipe(AddressInput)) input: AddressInput,
  ): Promise<AddressDto> {
    return this.addresses.update(user.id, id, input);
  }

  @Delete(':addressId')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('addressId') id: string): Promise<void> {
    await this.addresses.remove(user.id, id);
  }
}
