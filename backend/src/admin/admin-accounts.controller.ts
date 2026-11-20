import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import { AdminAccountsService } from './admin-accounts.service';
import { AccountActionDto } from './dto/account-action.dto';
import { AccountQueryDto } from './dto/account-query.dto';
import { CreateModeratorDto } from './dto/create-moderator.dto';

@ApiTags('Admin')
@ApiCookieAuth('access_token')
@ApiForbiddenResponse({ description: 'Admins only' })
@Roles(Role.ADMIN) // every route here is admin-only
@Controller('admin')
export class AdminAccountsController {
  constructor(private readonly accounts: AdminAccountsService) {}

  @Post('moderators')
  @ApiOperation({ summary: 'Create a moderator for one airline or hotel (ACC-13)' })
  @ApiCreatedResponse({ description: 'Moderator account created' })
  @ApiConflictResponse({ description: 'Email already registered' })
  createModerator(@CurrentUser() admin: AuthUser, @Body() dto: CreateModeratorDto) {
    return this.accounts.createModerator(admin, dto);
  }

  @Get('accounts')
  @ApiOperation({ summary: 'List and filter all accounts (ACC-14)' })
  @ApiOkResponse({ description: 'Paginated list of accounts' })
  findAll(@Query() query: AccountQueryDto) {
    return this.accounts.findAll(query);
  }

  @Patch('accounts/:id/suspend')
  @ApiOperation({ summary: 'Suspend a user or moderator account (ACC-15, ACC-16)' })
  @ApiOkResponse({ description: 'Account suspended; the user is blocked immediately' })
  @ApiBadRequestResponse({ description: 'Already suspended, own account, or an admin account' })
  @ApiNotFoundResponse({ description: 'Account not found' })
  suspend(@CurrentUser() admin: AuthUser, @Param('id') id: string, @Body() dto: AccountActionDto) {
    return this.accounts.suspend(admin, id, dto.reason);
  }

  @Patch('accounts/:id/reactivate')
  @ApiOperation({ summary: 'Reactivate a suspended account (ACC-15, ACC-16)' })
  @ApiOkResponse({ description: 'Account active again' })
  @ApiBadRequestResponse({ description: 'Account is not suspended' })
  @ApiNotFoundResponse({ description: 'Account not found' })
  reactivate(@CurrentUser() admin: AuthUser, @Param('id') id: string, @Body() dto: AccountActionDto) {
    return this.accounts.reactivate(admin, id, dto.reason);
  }

  @Post('users/:id/reset-password')
  @HttpCode(200)
  @ApiOperation({ summary: 'Admin-assisted password reset (ACC-07a)' })
  @ApiOkResponse({ description: 'Returns a one-time temporary password' })
  @ApiNotFoundResponse({ description: 'Account not found' })
  resetPassword(@CurrentUser() admin: AuthUser, @Param('id') id: string) {
    return this.accounts.resetPassword(admin, id);
  }
}