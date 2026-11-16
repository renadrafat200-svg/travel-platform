import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { RoomType } from '../../hotels/schemas/room.schema';

export type HotelBookingDocument = HydratedDocument<HotelBooking>;

/**
 * GEN-11 booking life cycle (same words as flight bookings, so Payments can treat both alike):
 *   pending   -> Pending Payment: all rooms are held for 10 minutes while the user pays
 *   confirmed -> paid (only Member 6's Stripe webhook calls confirm())
 *   completed -> the check-out time has passed (HTL-23)
 *   expired   -> not paid within 10 minutes; the rooms were released
 *   cancelled -> the user (or the hotel) cancelled a confirmed reservation
 * Allowed: pending -> confirmed -> completed, pending -> expired, confirmed -> cancelled.
 */
export enum HotelBookingStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
}

/** PAY-03: refund state shown on the booking. Member 6 moves it from pending to refunded or failed. */
export enum HotelRefundStatus {
  NONE = 'none',
  PENDING = 'pending',
  REFUNDED = 'refunded',
  FAILED = 'failed',
}

/**
 * One room of the reservation. Price and room details are copied in at booking time,
 * so later price changes never change what the user pays (HTL-05, HTL-16).
 */
@Schema({ _id: false })
export class BookedRoom {
  @Prop({ type: Types.ObjectId, ref: 'Room', required: true })
  room: Types.ObjectId;

  @Prop({ required: true })
  roomNumber: string;

  @Prop({ type: String, enum: RoomType, required: true })
  type: RoomType;

  @Prop({ required: true })
  beds: number;

  @Prop({ required: true })
  maxOccupancy: number;

  @Prop({ required: true, min: 0 })
  adults: number;

  /** Guests aged 0-17 */
  @Prop({ required: true, min: 0 })
  children: number;

  @Prop({ required: true, min: 0 })
  pricePerNight: number;

  /** nights x pricePerNight */
  @Prop({ required: true, min: 0 })
  amount: number;
}
const BookedRoomSchema = SchemaFactory.createForClass(BookedRoom);

/** The hotel's cancellation tiers at the moment of booking (later policy changes do not apply) */
@Schema({ _id: false })
export class BookedCancellationTier {
  @Prop({ required: true })
  daysBeforeCheckIn: number;

  @Prop({ required: true })
  refundPercent: number;
}
const BookedCancellationTierSchema = SchemaFactory.createForClass(
  BookedCancellationTier,
);

/** Stored in the "hotelbookings" collection (the leader's account-deletion check reads it) */
@Schema({ collection: 'hotelbookings', timestamps: true })
export class HotelBooking {
  _id: Types.ObjectId;

  /** Unique booking reference the guest sees, e.g. "H7QM2X" */
  @Prop({ required: true, unique: true })
  reference: string;

  /** Who booked it. Only this user (or an admin) can see it. */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  user: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Hotel', required: true, index: true })
  hotel: Types.ObjectId;

  @Prop({ required: true })
  hotelName: string;

  @Prop({ required: true })
  city: string;

  @Prop({ required: true })
  country: string;

  /** Exact moment of check-in: check-in date at the hotel's check-in time, in its time zone */
  @Prop({ required: true, index: true })
  checkIn: Date;

  /** Exact moment of check-out: check-out date at the hotel's check-out time */
  @Prop({ required: true, index: true })
  checkOut: Date;

  /** Hotel local dates "YYYY-MM-DD": first night and departure day */
  @Prop({ required: true })
  checkInDate: string;

  @Prop({ required: true })
  checkOutDate: string;

  @Prop({ required: true })
  timeZone: string;

  @Prop({ required: true, min: 1 })
  nights: number;

  @Prop({ type: [BookedRoomSchema], required: true })
  rooms: BookedRoom[];

  @Prop({ required: true, min: 1 })
  totalAdults: number;

  @Prop({ required: true, min: 0 })
  totalChildren: number;

  /** Account holder's name, shown to the hotel moderator */
  @Prop({ required: true })
  guestName: string;

  @Prop({ required: true })
  guestEmail: string;

  /** Sum over rooms of nights x price per night at booking time */
  @Prop({ required: true, min: 0 })
  totalAmount: number;

  /** Always the platform currency (PAY-04): USD */
  @Prop({ required: true, uppercase: true })
  currency: string;

  @Prop({ type: [BookedCancellationTierSchema], default: [] })
  cancellationTiers: BookedCancellationTier[];

  @Prop({
    type: String,
    enum: HotelBookingStatus,
    default: HotelBookingStatus.PENDING,
    index: true,
  })
  status: HotelBookingStatus;

  /** The rooms are only held until this moment unless the reservation is paid */
  @Prop({ required: true })
  holdExpiresAt: Date;

  @Prop()
  confirmedAt?: Date;

  /** Stripe PaymentIntent id, set by confirm() */
  @Prop()
  paymentReference?: string;

  @Prop()
  completedAt?: Date;

  @Prop()
  expiredAt?: Date;

  @Prop()
  cancelledAt?: Date;

  @Prop({ enum: ['user', 'hotel', 'admin'] })
  cancelledBy?: 'user' | 'hotel' | 'admin';

  @Prop({ trim: true, maxlength: 500 })
  cancellationReason?: string;

  @Prop({ min: 0, max: 100 })
  refundPercent?: number;

  @Prop({ min: 0 })
  refundAmount?: number;

  @Prop({
    type: String,
    enum: HotelRefundStatus,
    default: HotelRefundStatus.NONE,
  })
  refundStatus: HotelRefundStatus;

  /** Stripe refund id, set by markRefunded() */
  @Prop()
  refundReference?: string;

  createdAt: Date;
  updatedAt: Date;
}

export const HotelBookingSchema = SchemaFactory.createForClass(HotelBooking);
// The job looks up "pending and past holdExpiresAt" and "confirmed and past checkOut"
HotelBookingSchema.index({ status: 1, holdExpiresAt: 1 });
HotelBookingSchema.index({ status: 1, checkOut: 1 });
// "My reservations", newest first
HotelBookingSchema.index({ user: 1, createdAt: -1 });
// Moderator reservations view
HotelBookingSchema.index({ hotel: 1, checkIn: 1 });
// "Was this room ever reserved?" (room deletion)
HotelBookingSchema.index({ 'rooms.room': 1 });
