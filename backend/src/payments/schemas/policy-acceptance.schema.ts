import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PolicyAcceptanceDocument = HydratedDocument<PolicyAcceptance>;

export enum BookingType {
  FLIGHT = 'flight',
  HOTEL = 'hotel',
}

/**
 * PAY-02: the user ticked "I accept the provider's policies" for one booking.
 * Payment is blocked until this record exists. acceptedAt is the stored timestamp.
 */
@Schema({ collection: 'policyacceptances', timestamps: false })
export class PolicyAcceptance {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user: Types.ObjectId;

  @Prop({ type: String, enum: BookingType, required: true })
  bookingType: BookingType;

  @Prop({ type: Types.ObjectId, required: true })
  booking: Types.ObjectId;

  @Prop({ required: true })
  acceptedAt: Date;

  /** Copy of the policies exactly as they were shown, so later policy edits do not change what was accepted */
  @Prop({ type: Object, required: true })
  policies: Record<string, unknown>;
}

export const PolicyAcceptanceSchema = SchemaFactory.createForClass(PolicyAcceptance);
PolicyAcceptanceSchema.index({ bookingType: 1, booking: 1, user: 1 }, { unique: true });
