import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type RoomDocument = HydratedDocument<Room>;

export enum RoomType {
  SINGLE = 'single',
  DOUBLE = 'double',
  TWIN = 'twin',
  TRIPLE = 'triple',
  FAMILY = 'family',
  SUITE = 'suite',
}

/**
 * HTL-03: one room of a hotel. Each room can only be taken once per night (see RoomNight),
 * and only on nights inside one of its bookable ranges (see RoomRange).
 */
@Schema({ timestamps: true })
export class Room {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Hotel', required: true, index: true })
  hotel: Types.ObjectId;

  /** Room number or name, e.g. "204" or "Garden Suite". Unique inside one hotel. */
  @Prop({ required: true, trim: true, maxlength: 50 })
  roomNumber: string;

  @Prop({ type: String, enum: RoomType, required: true })
  type: RoomType;

  @Prop({ trim: true, maxlength: 2000 })
  description?: string;

  /** Number of beds */
  @Prop({ required: true, min: 1 })
  beds: number;

  /** Most guests (adults + children) that can stay in the room, at least 1 */
  @Prop({ required: true, min: 1 })
  maxOccupancy: number;

  /** USD, more than 0. Bookings copy it, so a change never affects existing reservations (HTL-05). */
  @Prop({ required: true, min: 0.01 })
  pricePerNight: number;

  @Prop({ type: [String], default: [] })
  amenities: string[];

  /** HTL-06: false = deactivated by the moderator; excluded from search and booking */
  @Prop({ default: true, index: true })
  isActive: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export const RoomSchema = SchemaFactory.createForClass(Room);
RoomSchema.index(
  { hotel: 1, roomNumber: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } },
);
