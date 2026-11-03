import { Body, Controller, Delete, Get, HttpCode, Patch, Res } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import { clearAuthCookie } from '../auth/auth-cookie';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UsersService } from './users.service';

@ApiTags('Users')
@ApiCookieAuth('access_token')
@ApiUnauthorizedResponse({ description: 'Not logged in or session expired' })
@ApiForbiddenResponse({ description: 'Account suspended' })
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'View my profile (ACC-11)' })
  @ApiOkResponse({ description: 'The logged-in user profile' })
  async getMe(@CurrentUser() user: AuthUser) {
    const doc = await this.users.findById(user.id);
    return this.users.toProfile(doc!);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update my profile and preferences (ACC-09)' })
  @ApiOkResponse({ description: 'The updated profile' })
  async updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    const doc = await this.users.updateProfile(user.id, dto);
    return this.users.toProfile(doc);
  }

  @Delete('me')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete (deactivate) my account (ACC-12)',
    description: 'The account can no longer log in. Existing bookings stay in the system.',
  })
  @ApiNoContentResponse({ description: 'Account deactivated and logged out' })
  async deleteMe(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    await this.users.deactivate(user.id);
    clearAuthCookie(res);
  }
}
