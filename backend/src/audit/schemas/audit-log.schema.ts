import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { Role } from '../../common/enums/role.enum';

export type AuditLogDocument = HydratedDocument<AuditLog>;

/**
 * One row per important action (GEN-07).
 * Only created, never edited or deleted, so it is a trustworthy history.
 */
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class AuditLog {
  /** Who did it */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  actor: Types.ObjectId;

  @Prop({ required: true })
  actorEmail: string;

  @Prop({ type: String, enum: Role, required: true })
  actorRole: Role;

  /** What they did, e.g. "account.suspend", "moderator.create", "report.resolve" */
  @Prop({ required: true, index: true })
  action: string;

  /** What it was done to, e.g. "user", "hotel", "airline", "post" */
  @Prop({ required: true, index: true })
  targetType: string;

  @Prop({ required: true })
  targetId: string;

  /** Extra information, e.g. { reason: "spam" } */
  @Prop({ type: MongooseSchema.Types.Mixed })
  details?: Record<string, unknown>;

  createdAt: Date;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
AuditLogSchema.index({ createdAt: -1 });