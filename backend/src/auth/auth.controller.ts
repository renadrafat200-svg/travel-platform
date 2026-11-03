import { Body, Controller, Get, HttpCode, Patch, Post, Res } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import { clearAuthCookie, setAuthCookie } from './auth-cookie';
import { AuthService } from './auth.service';
import { ChangePasswordDto, LoginDto, RegisterDto } from './dto/auth.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Register a new user account (ACC-01)' })
  @ApiCreatedResponse({ description: 'Account created. Log in next.' })
  @ApiBadRequestResponse({ description: 'Invalid email or weak password' })
  @ApiConflictResponse({ description: 'Email already registered' })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Log in (ACC-04, ACC-05)',
    description:
      'Sets an httpOnly access_token cookie. In Swagger, just call this once and the other endpoints work.',
  })
  @ApiOkResponse({ description: 'Logged in; cookie set' })
  @ApiUnauthorizedResponse({ description: 'Wrong email or password' })
  @ApiForbiddenResponse({ description: 'Account suspended' })
  @ApiResponse({ status: 423, description: 'Locked after too many failed attempts' })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const { token, user } = await this.auth.login(dto);
    setAuthCookie(res, token, this.auth.sessionMs);
    return { message: 'Logged in', user };
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Log out (ACC-06)' })
  @ApiNoContentResponse({ description: 'Cookie cleared' })
  logout(@Res({ passthrough: true }) res: Response) {
    clearAuthCookie(res);
  }

  @Get('me')
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Who am I? Current session info (ACC-04, ACC-19)' })
  @ApiOkResponse({ description: 'id, email, role and assigned provider (for moderators)' })
  @ApiUnauthorizedResponse({ description: 'Not logged in or session expired' })
  me(@CurrentUser() user: AuthUser) {
    return user;
  }

  @Patch('change-password')
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Change my password (ACC-08)',
    description: 'Logs out other devices; this device gets a fresh cookie.',
  })
  @ApiOkResponse({ description: 'Password changed' })
  @ApiBadRequestResponse({ description: 'Current password wrong or new password too weak' })
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = await this.auth.changePassword(user.id, dto);
    setAuthCookie(res, token, this.auth.sessionMs);
    return { message: 'Password changed' };
  }
}
