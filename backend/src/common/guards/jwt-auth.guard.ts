import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { AUTH_COOKIE_NAME } from '../../config/auth.constants';
import { UsersService } from '../../users/users.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AccountStatus } from '../enums/role.enum';
import { AuthUser, JwtPayload } from '../interfaces/auth-user.interface';

/**
 * Registered globally in AuthModule, so it runs on EVERY route.
 * - Reads the JWT from the httpOnly cookie (never from localStorage)
 * - Rejects expired or tampered tokens (session expiry)
 * - Loads the user from the database each time, so a suspension or a password change
 *   takes effect immediately, not only when the token expires
 * Routes marked @Public() skip the login requirement, but still get req.user if a valid cookie is sent.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const token = (req.cookies as Record<string, string> | undefined)?.[AUTH_COOKIE_NAME];

    if (!token) {
      if (isPublic) return true;
      throw new UnauthorizedException('You must be logged in');
    }

    try {
      req.user = await this.resolveUser(token);
    } catch (err) {
      if (isPublic) return true; // a bad cookie should not block a public page
      throw err;
    }
    return true;
  }

  private async resolveUser(token: string): Promise<AuthUser> {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Session expired or invalid, please log in again');
    }

    const user = await this.users.findById(payload.sub);
    if (!user) throw new UnauthorizedException('Account no longer exists');

    if (user.status === AccountStatus.SUSPENDED) {
      throw new ForbiddenException('Your account is suspended');
    }
    if (user.status === AccountStatus.DEACTIVATED) {
      throw new UnauthorizedException('This account has been deactivated');
    }

    // Tokens issued before the last password change are no longer valid
    if (user.passwordChangedAt && payload.iat) {
      const changedAtSeconds = Math.floor(user.passwordChangedAt.getTime() / 1000);
      if (payload.iat < changedAtSeconds) {
        throw new UnauthorizedException('Password was changed, please log in again');
      }
    }

    return {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      providerType: user.providerType,
      providerId: user.providerId?.toString(),
    };
  }
}
