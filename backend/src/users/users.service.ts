import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcryptjs';
import { Connection, Model, Types } from 'mongoose';
import { BCRYPT_ROUNDS } from '../config/auth.constants';
import { AccountStatus, ProviderType, Role } from '../common/enums/role.enum';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { User, UserDocument } from './schemas/user.schema';
import { SessionsService } from './sessions.service';

export interface CreateUserInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role?: Role;
  providerType?: ProviderType;
  providerId?: string | Types.ObjectId;
  /** ACC-13: accounts created by an admin must change their temporary password at first login */
  mustChangePassword?: boolean;
  /** ACC-01: set when the user accepted the terms and privacy policy */
  termsAcceptedAt?: Date;
}

/**
 * Shared user operations. Other modules (admin, notifications, bookings) can inject this service.
 */
@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectConnection() private readonly connection: Connection,
    private readonly sessions: SessionsService,
    private readonly reference: ReferenceDataService,
  ) {}

  findById(id: string | Types.ObjectId): Promise<UserDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.userModel.findById(id).exec();
  }

  findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email.toLowerCase().trim() }).exec();
  }

  /** Same as findByEmail but also loads the password hash (needed for login only) */
  findByEmailWithPassword(email: string): Promise<UserDocument | null> {
    return this.userModel
      .findOne({ email: email.toLowerCase().trim() })
      .select('+passwordHash')
      .exec();
  }

  findByIdWithPassword(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).select('+passwordHash').exec();
  }

  async emailExists(email: string): Promise<boolean> {
    return !!(await this.userModel.exists({ email: email.toLowerCase().trim() }));
  }

  async create(input: CreateUserInput): Promise<UserDocument> {
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    return this.userModel.create({
      email: input.email,
      passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      role: input.role ?? Role.USER,
      providerType: input.providerType,
      providerId: input.providerId ? new Types.ObjectId(input.providerId) : undefined,
      mustChangePassword: input.mustChangePassword ?? false,
      termsAcceptedAt: input.termsAcceptedAt,
    });
  }

  /**
   * Used by change-password (ACC-08) and the admin password reset (ACC-07a).
   * Logs the user out of every other session.
   * - mustChangePassword: true for an admin reset (the user must pick a new one at next login)
   * - keepSessionId: the session to keep (the device that just changed its own password)
   */
  async setPassword(
    userId: string,
    newPassword: string,
    options: { mustChangePassword?: boolean; keepSessionId?: string } = {},
  ): Promise<void> {
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    const res = await this.userModel
      .updateOne(
        { _id: userId },
        {
          $set: {
            passwordHash,
            passwordChangedAt: new Date(),
            failedLoginAttempts: 0,
            mustChangePassword: options.mustChangePassword ?? false,
          },
          $unset: { lockUntil: 1 },
        },
      )
      .exec();
    if (res.matchedCount === 0) throw new NotFoundException('User not found');
    await this.sessions.revokeAllForUser(userId, options.keepSessionId);
  }

  /**
   * ACC-12: true if the user has a Confirmed flight booking that has not departed yet,
   * or a Confirmed hotel reservation whose check-in has not passed yet.
   * Reads the bookings collections directly so this module does not depend on the booking modules.
   * NOTE for Member 4: hotel reservations are expected in "hotelbookings" with fields user, status, checkIn.
   */
  async hasUpcomingConfirmedBookings(userId: string): Promise<boolean> {
    const user = new Types.ObjectId(userId);
    const now = new Date();
    const flight = await this.connection
      .collection('flightbookings')
      .findOne({ user, status: 'confirmed', 'legs.departureTime': { $gt: now } }, { projection: { _id: 1 } });
    if (flight) return true;
    const hotel = await this.connection
      .collection('hotelbookings')
      .findOne({ user, status: 'confirmed', checkIn: { $gt: now } }, { projection: { _id: 1 } });
    return !!hotel;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<UserDocument> {
    const update: Record<string, unknown> = {};
    const { preferences, ...rest } = dto;
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) update[key] = value;
    }
    if (preferences?.currency) {
      const currency = preferences.currency.toUpperCase();
      // ACC-09 / ITN-18: only currencies from the official supported list
      if (!(await this.reference.isSupportedCurrency(currency))) {
        const supported = await this.reference.supportedCurrencies();
        throw new BadRequestException(`currency must be one of: ${supported.join(', ')}`);
      }
      update['preferences.currency'] = currency;
    }

    const res = await this.userModel
      .updateOne({ _id: userId }, { $set: update }, { runValidators: true })
      .exec();
    if (res.matchedCount === 0) throw new NotFoundException('User not found');
    return (await this.findById(userId))!;
  }

  /**
   * ACC-12: the account is kept (bookings still reference it) but can no longer log in.
   * Blocked while the user has upcoming Confirmed bookings.
   */
  async deactivate(userId: string): Promise<void> {
    if (await this.hasUpcomingConfirmedBookings(userId)) {
      throw new ConflictException(
        'You have upcoming confirmed bookings. Cancel them or wait until they are over before deleting your account.',
      );
    }
    await this.sessions.revokeAllForUser(userId);
    await this.userModel
      .updateOne(
        { _id: userId },
        { $set: { status: AccountStatus.DEACTIVATED, deactivatedAt: new Date() } },
      )
      .exec();
  }

  async recordFailedLogin(userId: Types.ObjectId, attempts: number, lockUntil?: Date) {
    await this.userModel
      .updateOne(
        { _id: userId },
        lockUntil
          ? { $set: { failedLoginAttempts: 0, lockUntil } }
          : { $set: { failedLoginAttempts: attempts } },
      )
      .exec();
  }

  async recordSuccessfulLogin(userId: Types.ObjectId) {
    await this.userModel
      .updateOne(
        { _id: userId },
        { $set: { failedLoginAttempts: 0, lastLoginAt: new Date() }, $unset: { lockUntil: 1 } },
      )
      .exec();
  }

  adminExists(): Promise<{ _id: Types.ObjectId } | null> {
    return this.userModel.exists({ role: Role.ADMIN }).exec();
  }

  /** Safe public shape of a user: never includes the password hash or lockout fields */
  toProfile(user: UserDocument) {
    return {
      id: user._id.toString(),
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      nationality: user.nationality,
      dateOfBirth: user.dateOfBirth,
      preferences: { currency: user.preferences?.currency ?? 'USD' },
      role: user.role,
      status: user.status,
      mustChangePassword: user.mustChangePassword ?? false,
      providerType: user.providerType,
      providerId: user.providerId?.toString(),
      createdAt: user.createdAt,
    };
  }
}
