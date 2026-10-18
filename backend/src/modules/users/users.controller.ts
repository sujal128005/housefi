import { Body, Controller, Delete, Get, HttpCode, Patch } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.guard';
import { type CustomerDto, UsersService } from './users.service';

/** openapi.yaml PATCH /me. Names need a letter (as the app checks); surrounding spaces are dropped. */
export const UpdateMeBody = z.object({
  name: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/\p{L}/u)
    .optional(),
  locale: z.enum(['en', 'te']).optional(),
});

/** The signed-in account. Technicians use it too (name and language for SMS / push); see docs/QUESTIONS.md #12. */
@Controller('me')
@Roles('CUSTOMER', 'TECHNICIAN')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  me(@CurrentUser() user: AuthUser): Promise<CustomerDto> {
    return this.users.me(user.id);
  }

  @Patch()
  update(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(UpdateMeBody)) body: z.infer<typeof UpdateMeBody>): Promise<CustomerDto> {
    return this.users.update(user.id, body);
  }

  @Delete()
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser): Promise<void> {
    await this.users.delete(user.id);
  }
}
