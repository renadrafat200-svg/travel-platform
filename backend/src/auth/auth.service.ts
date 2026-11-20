import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AccountStatus } from '../common/enums/role.enum';
import { JwtPayload } from '../common/interfaces/auth-user.interface';
import {
  ACCESS_TOKEN_MINUTES,
  LOCKOUT_MINUTES,
  MAX_FAILED_LOGIN_ATTEMPTS,
  SESSION_IDLE_MINUTES,
} from '../config/auth.constants';
import { UserDocument } from '../users/schemas/user.schema';
import { SessionsService } from '../users/sessions.service';
import { UsersService } from '../users/users.service';
import { ChangePasswordDto, LoginDto, RegisterDto } from './dto/auth.dto';

const INVALID_CREDENTIALS = 'Invalid email or password';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly sessions: SessionsService,
    private readonly jwt: JwtService,
  ) {}

  /** ACC-01: public registration always creates a normal user, never an admin or moderator */
  async register(dto: RegisterDto) {
    if (await this.users.emailExists(dto.email)) {
      throw new ConflictException('An account with this email already exists');
    }
    const user = await this.users.create({
      email: dto.email,
      password: dto.password,
      firstName: dto.firstName,
      lastName: dto.lastName,
      termsAcceptedAt: new Date(),
    });
    return this.users.toProfile(user);
  }

  /** ACC-04 / ACC-05: login with lockout after repeated failures; starts a server-side session (ACC-06) */
  async login(dto: LoginDto, userAgent?: string) {
    const user = await this.users.findByEmailWithPassword(dto.email);
    if (!user) throw new UnauthorizedException(INVALID_CREDENTIALS);

    if (user.lockUntil && user.lockUntil.getTime() > Date.now()) {
      const minutesLeft = Math.ceil((user.lockUntil.getTime() - Date.now()) / 60_000);
      throw new HttpException(
        {
          statusCode: 423,
          error: 'Locked',
          message: `Too many failed attempts. Try again in ${minutesLeft} minute(s)`,
        },
        423,
      );
    }

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      await this.handleFailedLogin(user);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    if (user.status === AccountStatus.SUSPENDED) {
      throw new ForbiddenException('Your account is suspended. Contact an administrator.');
    }
    if (user.status === AccountStatus.DEACTIVATED) {
      throw new UnauthorizedException('This account has been deactivated');
    }

    await this.users.recordSuccessfulLogin(user._id);
    const { sessionId, refreshToken } = await this.sessions.create(user._id, userAgent);
    return {
      accessToken: await this.signAccessToken(user, sessionId),
      refreshToken,
      user: this.users.toProfile(user),
    };
  }

  /**
   * ACC-06 / ACC-19: swaps a valid refresh token for a new access token and a new refresh token.
   * Fails if the session was logged out or has been idle for 30 minutes.
   */
  async refresh(refreshToken: string | undefined) {
    if (!refreshToken) throw new UnauthorizedException('You are logged out, please log in again');
    const result = await this.sessions.rotate(refreshToken);
    if (!result.ok) {
      throw new UnauthorizedException(
        result.reason === 'idle'
          ? `Your session ended after ${SESSION_IDLE_MINUTES} minutes of inactivity, please log in again`
          : 'You are logged out, please log in again',
      );
    }
    const user = await this.users.findById(result.session.user);
    if (!user || user.status !== AccountStatus.ACTIVE) {
      await this.sessions.revoke(result.session._id);
      throw new UnauthorizedException('This account can no longer log in');
    }
    return {
      accessToken: await this.signAccessToken(user, result.session._id.toString()),
      refreshToken: result.refreshToken,
    };
  }

  /** ACC-06: revokes the session on the server (found by its refresh token or the access token) */
  async logout(refreshToken: string | undefined, accessToken: string | undefined) {
    if (refreshToken) {
      const session = await this.sessions.findByRefreshToken(refreshToken);
      if (session) await this.sessions.revoke(session._id);
    }
    if (accessToken) {
      const payload = this.jwt.decode<JwtPayload | null>(accessToken);
      if (payload?.sid) await this.sessions.revoke(payload.sid);
    }
  }

  /**
   * ACC-08: requires the current password. Other devices are logged out; this device keeps its
   * session and gets a fresh access token. Also clears an admin-set temporary password (ACC-07a, ACC-13).
   */
  async changePassword(userId: string, sessionId: string, dto: ChangePasswordDto) {
    const user = await this.users.findByIdWithPassword(userId);
    if (!user) throw new UnauthorizedException();

    const ok = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!ok) throw new BadRequestException('Current password is incorrect');
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('New password must be different from the current password');
    }

    await this.users.setPassword(userId, dto.newPassword, {
      mustChangePassword: false,
      keepSessionId: sessionId,
    });
    const updated = await this.users.findById(userId);
    return this.signAccessToken(updated!, sessionId);
  }

  private async handleFailedLogin(user: UserDocument) {
    const attempts = (user.failedLoginAttempts ?? 0) + 1;
    if (attempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
      const lockUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60_000);
      await this.users.recordFailedLogin(user._id, attempts, lockUntil);
    } else {
      await this.users.recordFailedLogin(user._id, attempts);
    }
  }

  private signAccessToken(user: UserDocument, sessionId: string): Promise<string> {
    const payload: JwtPayload = { sub: user._id.toString(), role: user.role, sid: sessionId };
    return this.jwt.signAsync(payload, { expiresIn: ACCESS_TOKEN_MINUTES * 60 });
  }
}
