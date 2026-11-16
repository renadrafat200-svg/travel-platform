import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type RoomRangeDocument = HydratedDocument<RoomRange>;

/**
 * HTL-04: a date range when a room can be booked, defined by the moderator.
 * from = first bookable night, to = first night that is NOT in the range (like check-in / check-out).
 * The ranges of one room never overlap each other.
 */
@Schema({ collection: 'roomranges', timestamps: true })
export class RoomRange {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Room', required: true, index: true })
  room: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Hotel', required: true, index: true })
  hotel: Types.ObjectId;

  /** "YYYY-MM-DD", hotel local date */
  @Prop({ required: true })
  from: string;

  /** "YYYY-MM-DD", not included */
  @Prop({ required: true })
  to: string;

  createdAt: Date;
  updatedAt: Date;
}

export const RoomRangeSchema = SchemaFactory.createForClass(RoomRange);
RoomRangeSchema.index({ room: 1, from: 1 });
