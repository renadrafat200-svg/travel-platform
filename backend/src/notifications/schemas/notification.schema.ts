import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type NotificationDocument = HydratedDocument<Notification>;

/** GEN-01: every kind of in-app notification the platform sends */
export enum NotificationType {
  BOOKING_CONFIRMED = 'booking.confirmed',
  BOOKING_CANCELLED = 'booking.cancelled',
  REFUND_ISSUED = 'refund.issued',
  REFUND_REFUNDED = 'refund.refunded',
  REFUND_FAILED = 'refund.failed',
  PAYMENT_FAILED = 'payment.failed',
  FLIGHT_SCHEDULE_CHANGED = 'flight.schedule_changed',
  FLIGHT_CANCELLED = 'flight.cancelled',
  ACCOUNT_SUSPENDED = 'account.suspended',
  ACCOUNT_REACTIVATED = 'account.reactivated',
  PROVIDER_DEACTIVATED = 'provider.deactivated',
  PROVIDER_REACTIVATED = 'provider.reactivated',
  REPORT_RESOLVED = 'report.resolved',
}

@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class Notification {
  _id: Types.ObjectId;

  /** Who sees it. Only this user can list or read it. */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  user: Types.ObjectId;

  @Prop({ type: String, enum: NotificationType, required: true })
  type: NotificationType;

  @Prop({ required: true, trim: true, maxlength: 200 })
  title: string;

  @Prop({ required: true, trim: true, maxlength: 2000 })
  message: string;

  /** Links the notification to what it is about, e.g. { bookingType, bookingId, reference } */
  @Prop({ type: Object })
  data?: Record<string, unknown>;

  /** null until the user marks it as read */
  @Prop({ type: Date, default: null })
  readAt: Date | null;

  createdAt: Date;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);
// "My notifications, newest first" and "unread count"
NotificationSchema.index({ user: 1, createdAt: -1 });
NotificationSchema.index({ user: 1, readAt: 1 });
