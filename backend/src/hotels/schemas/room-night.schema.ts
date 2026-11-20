import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type RoomNightDocument = HydratedDocument<RoomNight>;

export enum RoomNightKind {
  /** Taken by a hotel booking (pending hold or confirmed) */
  BOOKING = 'booking',
  /** Blocked by the hotel moderator (maintenance, private event ...) */
  BLOCK = 'block',
}

/**
 * One taken night of one room. A room is free on a night exactly when no RoomNight exists for it.
 *
 * Why this makes double booking impossible: there is a UNIQUE index on (room, date).
 * If two people try to book room 204 for the night of 2026-12-01 at the same moment,
 * MongoDB can only store one of the two documents; the other insert fails with a
 * duplicate-key error and that whole booking transaction is rolled back.
 * Overlapping stays always share at least one night, so they always collide.
 */
@Schema({
  collection: 'roomnights',
  timestamps: { createdAt: true, updatedAt: false },
})
export class RoomNight {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Room', required: true })
  room: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Hotel', required: true })
  hotel: Types.ObjectId;

  /** The hotel's local date of the night, "YYYY-MM-DD" */
  @Prop({ required: true })
  date: string;

  @Prop({ type: String, enum: RoomNightKind, required: true })
  kind: RoomNightKind;

  /** Set when kind = booking */
  @Prop({ type: Types.ObjectId, ref: 'HotelBooking' })
  booking?: Types.ObjectId;

  /** Set when kind = block */
  @Prop({ type: Types.ObjectId, ref: 'RoomBlock' })
  block?: Types.ObjectId;

  createdAt: Date;
}

export const RoomNightSchema = SchemaFactory.createForClass(RoomNight);
// THE no-overlap rule: one document per room per night
RoomNightSchema.index({ room: 1, date: 1 }, { unique: true });
// Search: "which rooms of these hotels are taken on these nights?"
RoomNightSchema.index({ hotel: 1, date: 1 });
// Releasing a booking's or a block's nights
RoomNightSchema.index({ booking: 1 }, { sparse: true });
RoomNightSchema.index({ block: 1 }, { sparse: true });
