import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type FavouriteDocument = HydratedDocument<Favourite>;

/** What can be saved as a favourite */
export enum FavouriteType {
  HOTEL = 'hotel',
  ITINERARY = 'itinerary',
  POST = 'post',
}

/** Optional bonus: something a user saved to find again later */
@Schema({ collection: 'favourites', timestamps: { createdAt: true, updatedAt: false } })
export class Favourite {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user: Types.ObjectId;

  @Prop({ type: String, enum: FavouriteType, required: true })
  type: FavouriteType;

  @Prop({ type: Types.ObjectId, required: true })
  target: Types.ObjectId;

  createdAt: Date;
}

export const FavouriteSchema = SchemaFactory.createForClass(Favourite);
// One favourite per thing per user; also the "my favourites, newest first" lookup
FavouriteSchema.index({ user: 1, type: 1, target: 1 }, { unique: true });
FavouriteSchema.index({ user: 1, createdAt: -1 });
