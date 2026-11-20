import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

/**
 * ITN-12 / GEN-08: the bytes of an activity image, kept in the shared database like blog and
 * hotel images, so every teammate's backend can show it. Max 5 MB, under MongoDB's 16 MB limit.
 */
@Schema({
  collection: 'activityimagefiles',
  timestamps: { createdAt: true, updatedAt: false },
})
export class ActivityImageFile {
  @Prop({ required: true, unique: true })
  fileName: string;

  /** Lets us delete every file of an itinerary at once */
  @Prop({ type: Types.ObjectId, ref: 'Itinerary', required: true, index: true })
  itinerary: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  activity: Types.ObjectId;

  @Prop({ required: true })
  contentType: string;

  @Prop({ required: true })
  size: number;

  @Prop({ type: Buffer, required: true })
  data: Buffer;
}

export const ActivityImageFileSchema =
  SchemaFactory.createForClass(ActivityImageFile);
