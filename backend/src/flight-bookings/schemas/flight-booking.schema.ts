import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { CabinClass } from '../../flights/schemas/flight.schema';

export type FlightBookingDocument = HydratedDocument<FlightBooking>;

/**
 * The shared booking life cycle (same words as hotel bookings, so Payments can treat both alike):
 *   pending   -> seats are held, waiting for payment
 *   confirmed -> paid; tickets issued
 *   cancelled -> cancelled by the user, or the airline cancelled the flight
 *   expired   -> not paid in time; seats went back on sale
 */
export enum BookingStatus {
    PENDING = 'pending',
    CONFIRMED = 'confirmed',
    CANCELLED = 'cancelled',
    EXPIRED = 'expired',
}

export enum PassengerType {
    ADULT = 'adult',
    CHILD = 'child',
    INFANT = 'infant',
}

/** What happens to money after a cancellation. Member 6 (payments) moves it from pending to done. */
export enum RefundStatus {
    NONE = 'none',
    PENDING = 'pending',
    REFUNDED = 'refunded',
}

@Schema({ _id: false })
export class Passenger {
    @Prop({ required: true, trim: true })
    firstName: string;

    @Prop({ required: true, trim: true })
    lastName: string;

    /** "YYYY-MM-DD" */
    @Prop({ required: true })
    dateOfBirth: string;

    /** Worked out from the date of birth, never sent by the client */
    @Prop({ type: String, enum: PassengerType, required: true })
    type: PassengerType;

    /** Extra checked bags on top of the airline's free allowance (same on every flight of the trip) */
    @Prop({ default: 0, min: 0 })
    extraBags: number;
}
const PassengerSchema = SchemaFactory.createForClass(Passenger);

/**
 * One flight of the trip: the outbound, and for a round trip also the return.
 * Prices are copied in at booking time, so later price changes never change what the user pays.
 */
@Schema({ _id: false })
export class BookingLeg {
    @Prop({ type: Types.ObjectId, ref: 'Flight', required: true, index: true })
    flight: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: 'Airline', required: true })
    airline: Types.ObjectId;

    /** The _id of the cabin inside the flight document, used to give the seats back */
    @Prop({ type: Types.ObjectId, required: true })
    cabinId: Types.ObjectId;

    @Prop({ type: String, enum: CabinClass, required: true })
    cabinClass: CabinClass;

    @Prop({ required: true })
    flightNumber: string;

    @Prop({ required: true })
    origin: string;

    @Prop({ required: true })
    destination: string;

    /** UTC, copied at booking time (the live flight may be rescheduled later) */
    @Prop({ required: true })
    departureTime: Date;

    /** Seats taken from the cabin = adults + children (infants do not get a seat) */
    @Prop({ required: true, min: 1 })
    seats: number;

    @Prop({ required: true, min: 0 })
    fareAmount: number;

    @Prop({ required: true, min: 0 })
    baggageAmount: number;

    /** fareAmount + baggageAmount */
    @Prop({ required: true, min: 0 })
    amount: number;

    /** One e-ticket number per passenger, same order as `passengers`. Filled in on confirmation. */
    @Prop({ type: [String], default: [] })
    ticketNumbers: string[];
}
const BookingLegSchema = SchemaFactory.createForClass(BookingLeg);

@Schema({ timestamps: true })
export class FlightBooking {
    _id: Types.ObjectId;

    /** Short code the traveller sees, e.g. "K7QM2X" */
    @Prop({ required: true, unique: true })
    reference: string;

    /** Who booked it. Only this user (or an admin) can see it. */
    @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
    user: Types.ObjectId;

    @Prop({ type: [BookingLegSchema], required: true })
    legs: BookingLeg[];

    @Prop({ type: [PassengerSchema], required: true })
    passengers: Passenger[];

    @Prop({ required: true, min: 0 })
    totalAmount: number;

    @Prop({ required: true, uppercase: true })
    currency: string;

    @Prop({
        type: String,
        enum: BookingStatus,
        default: BookingStatus.PENDING,
        index: true,
    })
    status: BookingStatus;

    /** Seats are only held until this moment unless the booking is paid */
    @Prop({ required: true, index: true })
    holdExpiresAt: Date;

    @Prop()
    confirmedAt?: Date;

    /** Set by Member 6, e.g. the Stripe PaymentIntent id */
    @Prop()
    paymentReference?: string;

    @Prop()
    expiredAt?: Date;

    @Prop()
    cancelledAt?: Date;

    @Prop({ enum: ['user', 'airline', 'admin'] })
    cancelledBy?: 'user' | 'airline' | 'admin';

    @Prop({ trim: true, maxlength: 500 })
    cancellationReason?: string;

    @Prop({ min: 0, max: 100 })
    refundPercent?: number;

    @Prop({ min: 0 })
    refundAmount?: number;

    @Prop({ type: String, enum: RefundStatus, default: RefundStatus.NONE })
    refundStatus: RefundStatus;

    createdAt: Date;
    updatedAt: Date;
}

export const FlightBookingSchema = SchemaFactory.createForClass(FlightBooking);
// The expiry job looks up "pending and past holdExpiresAt"
FlightBookingSchema.index({ status: 1, holdExpiresAt: 1 });
// "My bookings", newest first
FlightBookingSchema.index({ user: 1, createdAt: -1 });
// Passenger list and airline cancellations look up bookings by flight
FlightBookingSchema.index({ 'legs.flight': 1, status: 1 });