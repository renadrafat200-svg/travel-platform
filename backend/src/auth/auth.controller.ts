import { Body, Controller, Get, HttpCode, Patch, Post, Req, Res } from '@nestjs/common';
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
import type { Request, Response } from 'express';
import { AllowPasswordChangePending } from '../common/decorators/allow-password-change-pending.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import { AUTH_COOKIE_NAME, REFRESH_COOKIE_NAME } from '../config/auth.constants';
import { clearAuthCookies, setAuthCookies } from './auth-cookie';
import { AuthService } from './auth.service';
import { ChangePasswordDto, LoginDto, RegisterDto } from './dto/auth.dto';

const cookie = (req: Request, name: string) =>
  (req.cookies as Record<string, string> | undefined)?.[name];

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @ApiOperation({
    summary: 'Register a new user account (ACC-01)',
    description: 'Password: at least 8 characters with a letter and a digit. acceptTerms must be true.',
  })
  @ApiCreatedResponse({ description: 'Account created. Log in next.' })
  @ApiBadRequestResponse({ description: 'Invalid email, weak password, or terms not accepted' })
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
      'Sets two httpOnly cookies: access_token (15 min) and refresh_token. In Swagger, call this once and the ' +
      'other endpoints work. If user.mustChangePassword is true, only change-password, me and logout are allowed.',
  })
  @ApiOkResponse({ description: 'Logged in; cookies set' })
  @ApiUnauthorizedResponse({ description: 'Wrong email or password' })
  @ApiForbiddenResponse({ description: 'Account suspended' })
  @ApiResponse({ status: 423, description: 'Locked for 15 minutes after 5 failed attempts' })
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { accessToken, refreshToken, user } = await this.auth.login(dto, req.headers['user-agent']);
    setAuthCookies(res, accessToken, refreshToken);
    return { message: 'Logged in', user };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Get a new access token using the refresh_token cookie (ACC-06, ACC-19)',
    description: 'Fails once the session was logged out or had no authenticated request for 30 minutes.',
  })
  @ApiOkResponse({ description: 'New cookies set' })
  @ApiUnauthorizedResponse({ description: 'Logged out or session expired' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      const { accessToken, refreshToken } = await this.auth.refresh(cookie(req, REFRESH_COOKIE_NAME));
      setAuthCookies(res, accessToken, refreshToken);
      return { message: 'Session refreshed' };
    } catch (err) {
      clearAuthCookies(res);
      throw err;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Log out: clears the cookies and revokes the session on the server (ACC-06)' })
  @ApiNoContentResponse({ description: 'Logged out' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(cookie(req, REFRESH_COOKIE_NAME), cookie(req, AUTH_COOKIE_NAME));
    clearAuthCookies(res);
  }

  @Get('me')
  @AllowPasswordChangePending()
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Who am I? Current session info (ACC-04, ACC-19)' })
  @ApiOkResponse({ description: 'id, email, role, assigned provider (moderators) and mustChangePassword' })
  @ApiUnauthorizedResponse({ description: 'Not logged in or session expired' })
  me(@CurrentUser() user: AuthUser) {
    const { sessionId: _sessionId, ...profile } = user;
    return profile;
  }

  @Patch('change-password')
  @AllowPasswordChangePending()
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Change my password (ACC-08); also replaces an admin-set temporary password (ACC-07a, ACC-13)',
    description: 'Logs out other devices; this device stays logged in with a fresh access token.',
  })
  @ApiOkResponse({ description: 'Password changed' })
  @ApiBadRequestResponse({ description: 'Current password wrong or new password breaks the rules' })
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const accessToken = await this.auth.changePassword(user.id, user.sessionId!, dto);
    setAuthCookies(res, accessToken); // the refresh cookie stays the same

    return { message: 'Password changed' };
  }
}
