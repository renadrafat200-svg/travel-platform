import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter, Types } from 'mongoose';
import { paginate } from '../common/dto/pagination-query.dto';
import { AuthUser } from '../common/interfaces/auth-user.interface';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';
import { AuditLog } from './schemas/audit-log.schema';

export interface AuditEntry {
  action: string;
  targetType: string;
  targetId: string | Types.ObjectId;
  details?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@InjectModel(AuditLog.name) private readonly auditModel: Model<AuditLog>) {}

  /**
   * Call this from any module after an important action:
   *   await this.audit.log(user, { action: 'account.suspend', targetType: 'user', targetId: id });
   * A failure here is logged but never breaks the action itself.
   */
  async log(actor: AuthUser, entry: AuditEntry): Promise<void> {
    try {
      await this.auditModel.create({
        actor: new Types.ObjectId(actor.id),
        actorEmail: actor.email,
        actorRole: actor.role,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId.toString(),
        details: entry.details,
      });
    } catch (err) {
      this.logger.error(`Could not write audit log for ${entry.action}`, err as Error);
    }
  }

  /** GEN-07: newest first, with optional filters */
  async findAll(query: AuditLogQueryDto) {
    const filter: QueryFilter<AuditLog> = {};
    if (query.action) filter.action = query.action;
    if (query.targetType) filter.targetType = query.targetType;
    if (query.actorId) filter.actor = new Types.ObjectId(query.actorId);
    if (query.from || query.to) {
      filter.createdAt = {};
      if (query.from) filter.createdAt.$gte = new Date(query.from);
      if (query.to) filter.createdAt.$lte = new Date(query.to);
    }

    const [items, total] = await Promise.all([
      this.auditModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(query.skip)
        .limit(query.limit)
        .lean()
        .exec(),
      this.auditModel.countDocuments(filter).exec(),
    ]);
    return paginate(items, total, query);
  }
}