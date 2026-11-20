import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ReportTargetType } from '../reportable-content';

export type ReportDocument = HydratedDocument<Report>;

export enum ReportReason {
  SPAM = 'spam',
  OFFENSIVE = 'offensive',
  INAPPROPRIATE = 'inappropriate',
  FALSE_INFORMATION = 'false_information',
  OTHER = 'other',
}

export enum ReportStatus {
  OPEN = 'open',
  DISMISSED = 'dismissed',
  CONTENT_HIDDEN = 'content_hidden',
  CONTENT_DELETED = 'content_deleted',
}

@Schema({ timestamps: true })
export class Report {
  _id: Types.ObjectId;

  /** The user who reported it */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  reporter: Types.ObjectId;

  @Prop({ type: String, enum: ReportTargetType, required: true })
  targetType: ReportTargetType;

  @Prop({ type: Types.ObjectId, required: true })
  targetId: Types.ObjectId;

  @Prop({ type: String, enum: ReportReason, required: true })
  reason: ReportReason;

  @Prop({ trim: true, maxlength: 1000 })
  details?: string;

  @Prop({ type: String, enum: ReportStatus, default: ReportStatus.OPEN, index: true })
  status: ReportStatus;

  /** Filled in when an admin handles the report */
  @Prop({ type: Types.ObjectId, ref: 'User' })
  resolvedBy?: Types.ObjectId;

  @Prop()
  resolvedAt?: Date;

  @Prop({ trim: true, maxlength: 1000 })
  resolutionNote?: string;

  createdAt: Date;
  updatedAt: Date;
}

export const ReportSchema = SchemaFactory.createForClass(Report);
ReportSchema.index({ targetType: 1, targetId: 1, status: 1 });
ReportSchema.index({ createdAt: -1 });