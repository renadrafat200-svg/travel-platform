import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AccountStatus } from '../common/enums/role.enum';
import { JwtPayload } from '../common/interfaces/auth-user.interface';
import { LOCKOUT_MINUTES, MAX_FAILED_LOGIN_ATTEMPTS } from '../config/auth.constants';
import { UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { durationToMs } from './auth-cookie';
import { ChangePasswordDto, LoginDto, RegisterDto } from './dto/auth.dto';

const INVALID_CREDENTIALS = 'Invalid email or password';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /** Cookie lifetime matches the token lifetime, so both expire together */
  get sessionMs(): number {
    return durationToMs(this.config.get<string>('JWT_EXPIRES_IN'));
  }

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
    });
    return this.users.toProfile(user);
  }

  /** ACC-04 / ACC-05: login with lockout after repeated failures */
  async login(dto: LoginDto): Promise<{ token: string; user: ReturnType<UsersService['toProfile']> }> {
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
    return { token: await this.signToken(user), user: this.users.toProfile(user) };
  }

  /** ACC-08: requires the current password; old sessions on other devices stop working */
  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.users.findByIdWithPassword(userId);
    if (!user) throw new UnauthorizedException();

    const ok = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!ok) throw new BadRequestException('Current password is incorrect');
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('New password must be different from the current password');
    }

    await this.users.setPassword(userId, dto.newPassword);
    const updated = await this.users.findById(userId);
    return this.signToken(updated!);
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

  private signToken(user: UserDocument): Promise<string> {
    const payload: JwtPayload = { sub: user._id.toString(), role: user.role };
    return this.jwt.signAsync(payload, { expiresIn: Math.floor(this.sessionMs / 1000) });
  }
}
