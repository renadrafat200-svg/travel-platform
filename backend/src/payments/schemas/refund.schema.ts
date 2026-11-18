import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { BookingType } from './policy-acceptance.schema';

export type RefundDocument = HydratedDocument<Refund>;

/** PAY-03: shown on the booking as Pending / Refunded / Failed */
export enum RefundRecordStatus {
  PENDING = 'pending',
  REFUNDED = 'refunded',
  FAILED = 'failed',
}

/** One Stripe refund. Created for every cancellation with a positive refund amount. */
@Schema({ collection: 'refunds', timestamps: true })
export class Refund {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  user: Types.ObjectId;

  @Prop({ type: String, enum: BookingType, required: true })
  bookingType: BookingType;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  booking: Types.ObjectId;

  /** The payment being refunded. A payment is refunded at most once. */
  @Prop({ type: Types.ObjectId, ref: 'Payment', required: true, unique: true })
  payment: Types.ObjectId;

  /** Stripe refund id, e.g. "re_3Q..." (empty only if Stripe refused the request) */
  @Prop({ index: true, sparse: true })
  stripeRefundId?: string;

  /** USD, not cents */
  @Prop({ required: true, min: 0 })
  amount: number;

  @Prop({ required: true, uppercase: true })
  currency: string;

  @Prop({ type: String, enum: RefundRecordStatus, default: RefundRecordStatus.PENDING, index: true })
  status: RefundRecordStatus;

  /** user_cancellation | provider_cancellation | hold_expired */
  @Prop({ required: true })
  reason: string;

  createdAt: Date;
  updatedAt: Date;
}

export const RefundSchema = SchemaFactory.createForClass(Refund);
RefundSchema.index({ user: 1, createdAt: -1 });
