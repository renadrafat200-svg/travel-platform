import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type RoomBlockDocument = HydratedDocument<RoomBlock>;

/**
 * A period when the moderator takes a room off sale, e.g. for maintenance.
 * from = first blocked night, to = first night that is free again (same idea as check-in/check-out).
 * Each blocked night is also stored as a RoomNight, so bookings and blocks can never overlap.
 */
@Schema({ timestamps: true })
export class RoomBlock {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Room', required: true, index: true })
  room: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Hotel', required: true, index: true })
  hotel: Types.ObjectId;

  @Prop({ required: true })
  from: string;

  @Prop({ required: true })
  to: string;

  @Prop({ trim: true, maxlength: 300 })
  reason?: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

export const RoomBlockSchema = SchemaFactory.createForClass(RoomBlock);
