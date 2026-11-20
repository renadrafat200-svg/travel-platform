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
import { AUTH_COOKIE_NAME, SESSION_IDLE_MINUTES } from '../../config/auth.constants';
import { SessionsService } from '../../users/sessions.service';
import { UsersService } from '../../users/users.service';
import { ALLOW_PASSWORD_CHANGE_PENDING_KEY } from '../decorators/allow-password-change-pending.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AccountStatus } from '../enums/role.enum';
import { AuthUser, JwtPayload } from '../interfaces/auth-user.interface';

/**
 * Registered globally in AuthModule, so it runs on EVERY route.
 * - Reads the access token from the httpOnly cookie (never from localStorage) (ACC-19)
 * - Checks the server-side session: revoked by logout, or idle for 30 minutes = logged out (ACC-06)
 * - Loads the user each time, so a suspension or password change takes effect immediately
 * - Blocks everything except changing the password while a temporary password is in use (ACC-07a, ACC-13)
 * Routes marked @Public() skip the login requirement, but still get req.user if a valid cookie is sent.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly users: UsersService,
    private readonly sessions: SessionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
    const allowPending = this.reflector.getAllAndOverride<boolean>(ALLOW_PASSWORD_CHANGE_PENDING_KEY, targets);
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const token = (req.cookies as Record<string, string> | undefined)?.[AUTH_COOKIE_NAME];

    if (!token) {
      if (isPublic) return true;
      throw new UnauthorizedException('You must be logged in');
    }

    let user: AuthUser;
    try {
      user = await this.resolveUser(token);
    } catch (err) {
      if (isPublic) return true; // a bad cookie should not block a public page
      throw err;
    }
    req.user = user;

    if (user.mustChangePassword && !isPublic && !allowPending) {
      throw new ForbiddenException('You must change your temporary password before continuing');
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

    const check = await this.sessions.checkById(payload.sid);
    if (!check.ok) {
      throw new UnauthorizedException(
        check.reason === 'idle'
          ? `Your session ended after ${SESSION_IDLE_MINUTES} minutes of inactivity, please log in again`
          : 'You are logged out, please log in again',
      );
    }

    const user = await this.users.findById(payload.sub);
    if (!user) throw new UnauthorizedException('Account no longer exists');

    if (user.status === AccountStatus.SUSPENDED) {
      throw new ForbiddenException('Your account is suspended');
    }
    if (user.status === AccountStatus.DEACTIVATED) {
      throw new UnauthorizedException('This account has been deactivated');
    }

    await this.sessions.touch(check.session);

    return {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      providerType: user.providerType,
      providerId: user.providerId?.toString(),
      sessionId: payload.sid,
      mustChangePassword: user.mustChangePassword ?? false,
    };
  }
}
