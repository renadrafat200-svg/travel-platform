import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { BookingType } from './policy-acceptance.schema';

export type PaymentDocument = HydratedDocument<Payment>;

/**
 * pending   -> PaymentIntent created, waiting for the card (or processing)
 * succeeded -> Stripe says the money was taken (the webhook then confirms the booking)
 * failed    -> the card was declined; the user may retry while the hold lasts
 * cancelled -> the hold expired (or a newer attempt replaced it) and the PaymentIntent was cancelled
 * refunded  -> paid after the hold expired, so the money was sent straight back
 */
export enum PaymentStatus {
  PENDING = 'pending',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  REFUNDED = 'refunded',
}

/**
 * PAY-01: one payment attempt for a booking. Only the Stripe payment id, amount, currency and
 * status are stored (plus who / which booking / when). Card details never reach this backend.
 */
@Schema({ collection: 'payments', timestamps: true })
export class Payment {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  user: Types.ObjectId;

  @Prop({ type: String, enum: BookingType, required: true })
  bookingType: BookingType;

  @Prop({ type: Types.ObjectId, required: true })
  booking: Types.ObjectId;

  /** Stripe PaymentIntent id, e.g. "pi_3Q..." */
  @Prop({ required: true, unique: true })
  stripePaymentId: string;

  /** In the platform currency (USD), not cents */
  @Prop({ required: true, min: 0 })
  amount: number;

  @Prop({ required: true, uppercase: true })
  currency: string;

  @Prop({ type: String, enum: PaymentStatus, default: PaymentStatus.PENDING, index: true })
  status: PaymentStatus;

  /** Copied from the booking so the expiry job can find attempts to cancel */
  @Prop({ required: true })
  holdExpiresAt: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);
PaymentSchema.index({ bookingType: 1, booking: 1, createdAt: -1 });
PaymentSchema.index({ status: 1, holdExpiresAt: 1 });
