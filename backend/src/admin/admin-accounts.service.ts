import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomBytes } from 'crypto';
import { Model, QueryFilter, Types } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import { paginate } from '../common/dto/pagination-query.dto';
import { AccountStatus, ProviderType, Role } from '../common/enums/role.enum';
import { AuthUser } from '../common/interfaces/auth-user.interface';
import { User, UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { AccountQueryDto } from './dto/account-query.dto';
import { CreateModeratorDto } from './dto/create-moderator.dto';

@Injectable()
export class AdminAccountsService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  /** ACC-13: create a moderator assigned to exactly one airline or hotel */
  async createModerator(admin: AuthUser, dto: CreateModeratorDto) {
    if (await this.users.emailExists(dto.email)) {
      throw new ConflictException('An account with this email already exists');
    }
    // TODO: once the Airlines (Member 2) and Hotels (Member 4) modules are merged,
    // check that the airline/hotel with dto.providerId really exists and return 404 if not.

    const role =
      dto.providerType === ProviderType.AIRLINE ? Role.AIRLINE_MODERATOR : Role.HOTEL_MODERATOR;
    const moderator = await this.users.create({
      email: dto.email,
      password: dto.password,
      firstName: dto.firstName,
      lastName: dto.lastName,
      role,
      providerType: dto.providerType,
      providerId: dto.providerId,
    });

    await this.audit.log(admin, {
      action: 'moderator.create',
      targetType: 'user',
      targetId: moderator._id,
      details: { role, providerType: dto.providerType, providerId: dto.providerId },
    });
    return this.users.toProfile(moderator);
  }

  /** ACC-14: list and filter all accounts */
  async findAll(query: AccountQueryDto) {
    const filter: QueryFilter<User> = {};
    if (query.role) filter.role = query.role;
    if (query.status) filter.status = query.status;
    if (query.search) {
      // escape regex special characters so a search like "a+b" is safe
      const safe = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(safe, 'i');
      filter.$or = [{ email: re }, { firstName: re }, { lastName: re }];
    }

    const sortField = query.sortBy ?? 'createdAt';
    const sortDir = query.sortBy ? (query.order === 'desc' ? -1 : 1) : -1;

    const [docs, total] = await Promise.all([
      this.userModel
        .find(filter)
        .sort({ [sortField]: sortDir })
        .skip(query.skip)
        .limit(query.limit)
        .exec(),
      this.userModel.countDocuments(filter).exec(),
    ]);
    return paginate(
      docs.map((d) => this.users.toProfile(d)),
      total,
      query,
    );
  }

  /** ACC-15 / ACC-16: suspend an account. The user is blocked on their very next request. */
  async suspend(admin: AuthUser, id: string, reason?: string) {
    const target = await this.getManageableAccount(admin, id);
    if (target.status === AccountStatus.SUSPENDED) {
      throw new BadRequestException('Account is already suspended');
    }
    if (target.status === AccountStatus.DEACTIVATED) {
      throw new BadRequestException('Account was deleted by its owner and cannot be suspended');
    }
    await this.userModel
      .updateOne({ _id: target._id }, { $set: { status: AccountStatus.SUSPENDED } })
      .exec();
    await this.audit.log(admin, {
      action: 'account.suspend',
      targetType: 'user',
      targetId: target._id,
      details: { reason, email: target.email },
    });
    // TODO: when Notifications (Member 6) is merged, notify the user here.
    return { message: 'Account suspended', id: target._id.toString(), status: AccountStatus.SUSPENDED };
  }

  /** ACC-15 / ACC-16: reactivate a suspended account */
  async reactivate(admin: AuthUser, id: string, reason?: string) {
    const target = await this.getManageableAccount(admin, id);
    if (target.status !== AccountStatus.SUSPENDED) {
      throw new BadRequestException('Only suspended accounts can be reactivated');
    }
    await this.userModel
      .updateOne(
        { _id: target._id },
        { $set: { status: AccountStatus.ACTIVE, failedLoginAttempts: 0 }, $unset: { lockUntil: 1 } },
      )
      .exec();
    await this.audit.log(admin, {
      action: 'account.reactivate',
      targetType: 'user',
      targetId: target._id,
      details: { reason, email: target.email },
    });
    return { message: 'Account reactivated', id: target._id.toString(), status: AccountStatus.ACTIVE };
  }

  /**
   * ACC-07a: admin-assisted password reset.
   * Generates a temporary password, shown once, which the admin gives to the user.
   * All the user's existing sessions stop working, and any lockout is cleared.
   */
  async resetPassword(admin: AuthUser, id: string) {
    const target = await this.getManageableAccount(admin, id);
    const temporaryPassword = this.generateTemporaryPassword();
    await this.users.setPassword(target._id.toString(), temporaryPassword);
    await this.audit.log(admin, {
      action: 'account.reset_password',
      targetType: 'user',
      targetId: target._id,
      details: { email: target.email }, // never store the password itself
    });
    return {
      message: 'Password reset. Give this temporary password to the user and ask them to change it.',
      temporaryPassword,
    };
  }

  /** Loads the account and blocks actions on yourself or on other admins */
  private async getManageableAccount(admin: AuthUser, id: string): Promise<UserDocument> {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid account id');
    const target = await this.users.findById(id);
    if (!target) throw new NotFoundException('Account not found');
    if (target._id.toString() === admin.id) {
      throw new BadRequestException('You cannot perform this action on your own account');
    }
    if (target.role === Role.ADMIN) {
      throw new BadRequestException('Administrator accounts cannot be managed here');
    }
    return target;
  }

  /** e.g. "Tmp-K7mQ2xP97aA" — always meets the password rules */
  private generateTemporaryPassword(): string {
    const random = randomBytes(9).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 8);
    return `Tmp-${random}7aA`;
  }
}