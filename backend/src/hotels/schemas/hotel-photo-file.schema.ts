import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type HotelPhotoFileDocument = HydratedDocument<HotelPhotoFile>;

/**
 * GEN-08: the actual image bytes of a hotel photo, stored in MongoDB (not on the laptop's disk)
 * so every teammate's backend, connected to the same Atlas database, can show the same photos.
 * A photo is at most 5 MB, well under MongoDB's 16 MB document limit.
 * Hotel.photos keeps the light info (url, type, size); this collection keeps the file itself.
 */
@Schema({
  collection: 'hotelphotofiles',
  timestamps: { createdAt: true, updatedAt: false },
})
export class HotelPhotoFile {
  _id: Types.ObjectId;

  /** Same name as in Hotel.photos[].fileName, e.g. "6a1f...-<uuid>.jpg" */
  @Prop({ required: true, unique: true })
  fileName: string;

  @Prop({ type: Types.ObjectId, ref: 'Hotel', required: true, index: true })
  hotel: Types.ObjectId;

  @Prop({ required: true })
  contentType: string;

  @Prop({ required: true })
  size: number;

  @Prop({ type: Buffer, required: true })
  data: Buffer;

  createdAt: Date;
}

export const HotelPhotoFileSchema =
  SchemaFactory.createForClass(HotelPhotoFile);
