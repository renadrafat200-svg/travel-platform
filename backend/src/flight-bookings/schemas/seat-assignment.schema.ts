import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type SeatAssignmentDocument = HydratedDocument<SeatAssignment>;

/**
 * FLT-28 (optional): one seat on one flight, taken by one passenger of one booking.
 * The unique index on (flight, seat) is what makes seat selection concurrency-safe:
 * if two people pick seat 12A at the same moment, MongoDB accepts only one insert.
 */
@Schema({ collection: 'seatassignments', timestamps: { createdAt: true, updatedAt: false } })
export class SeatAssignment {
    _id: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: 'Flight', required: true })
    flight: Types.ObjectId;

    /** e.g. "12A" */
    @Prop({ required: true, uppercase: true })
    seat: string;

    @Prop({ type: Types.ObjectId, ref: 'FlightBooking', required: true, index: true })
    booking: Types.ObjectId;

    /** 0-based position in booking.passengers */
    @Prop({ required: true, min: 0 })
    passengerIndex: number;

    createdAt: Date;
}

export const SeatAssignmentSchema = SchemaFactory.createForClass(SeatAssignment);
SeatAssignmentSchema.index({ flight: 1, seat: 1 }, { unique: true });
SeatAssignmentSchema.index({ flight: 1, booking: 1, passengerIndex: 1 }, { unique: true });
