import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcryptjs';
import { Model, Types } from 'mongoose';
import { BCRYPT_ROUNDS } from '../config/auth.constants';
import { AccountStatus, ProviderType, Role } from '../common/enums/role.enum';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { User, UserDocument } from './schemas/user.schema';

export interface CreateUserInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role?: Role;
  providerType?: ProviderType;
  providerId?: string | Types.ObjectId;
}

/**
 * Shared user operations. Other modules (admin, notifications, bookings) can inject this service.
 */
@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private readonly userModel: Model<User>) {}

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
    });
  }

  /** Used by change-password and by the admin password reset (ACC-07a) */
  async setPassword(userId: string, newPassword: string): Promise<void> {
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    const res = await this.userModel
      .updateOne(
        { _id: userId },
        {
          $set: { passwordHash, passwordChangedAt: new Date(), failedLoginAttempts: 0 },
          $unset: { lockUntil: 1 },
        },
      )
      .exec();
    if (res.matchedCount === 0) throw new NotFoundException('User not found');
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<UserDocument> {
    const update: Record<string, unknown> = {};
    const { preferences, ...rest } = dto;
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) update[key] = value;
    }
    if (preferences?.currency) update['preferences.currency'] = preferences.currency.toUpperCase();

    const res = await this.userModel
      .updateOne({ _id: userId }, { $set: update }, { runValidators: true })
      .exec();
    if (res.matchedCount === 0) throw new NotFoundException('User not found');
    return (await this.findById(userId))!;
  }

  /** ACC-12: the account is kept (bookings still reference it) but can no longer log in */
  async deactivate(userId: string): Promise<void> {
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
      providerType: user.providerType,
      providerId: user.providerId?.toString(),
      createdAt: user.createdAt,
    };
  }
}
