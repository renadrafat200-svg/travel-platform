import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type HotelDocument = HydratedDocument<Hotel>;

/**
 * HTL-10: one refund tier, e.g. { daysBeforeCheckIn: 7, refundPercent: 100 }
 * = "cancel 7 or more days before check-in and get 100% back".
 */
@Schema({ _id: false })
export class CancellationTier {
  @Prop({ required: true, min: 0 })
  daysBeforeCheckIn: number;

  @Prop({ required: true, min: 0, max: 100 })
  refundPercent: number;
}
const CancellationTierSchema = SchemaFactory.createForClass(CancellationTier);

/** HTL-09 / HTL-10: shown to travellers before they book and accepted before paying */
@Schema({ _id: false })
export class HotelPolicies {
  /** HTL-09: standard check-in time, local hotel time "HH:mm" */
  @Prop({ required: true })
  checkInTime: string;

  /** HTL-09: standard check-out time, local hotel time "HH:mm" */
  @Prop({ required: true })
  checkOutTime: string;

  /** HTL-10: sorted from the highest threshold to the lowest; thresholds are unique */
  @Prop({ type: [CancellationTierSchema], default: [] })
  cancellationTiers: CancellationTier[];

  @Prop({ trim: true, maxlength: 2000 })
  notes?: string;
}
const HotelPoliciesSchema = SchemaFactory.createForClass(HotelPolicies);

/** GEN-08: an uploaded photo (JPG or PNG, max 5 MB). The image itself is in the hotelphotofiles collection. */
@Schema({ _id: true })
export class HotelPhoto {
  _id: Types.ObjectId;

  /** Name of the image in the hotelphotofiles collection */
  @Prop({ required: true })
  fileName: string;

  /** e.g. /api/hotels/photos/6a1f...-1.jpg */
  @Prop({ required: true })
  url: string;

  @Prop({ required: true })
  contentType: string;

  @Prop({ required: true })
  size: number;
}
const HotelPhotoSchema = SchemaFactory.createForClass(HotelPhoto);

/** HTL-01: model name Hotel, with isActive (Member 1 deactivates providers) */
@Schema({ timestamps: true })
export class Hotel {
  _id: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 120 })
  name: string;

  @Prop({ required: true, trim: true, maxlength: 300 })
  address: string;

  /** Official city id from the reference data, e.g. "cairo" */
  @Prop({
    type: String,
    ref: 'City',
    required: true,
    lowercase: true,
    index: true,
  })
  city: string;

  /** Official country code of that city, e.g. "EG" */
  @Prop({
    type: String,
    ref: 'Country',
    required: true,
    uppercase: true,
    index: true,
  })
  country: string;

  /**
   * IANA time zone of the city (from the city's airport in the official dataset), e.g. "Africa/Cairo".
   * "Today", check-in and check-out moments are worked out in this zone.
   */
  @Prop({ required: true })
  timeZone: string;

  @Prop({ trim: true, maxlength: 3000 })
  description?: string;

  /** Star class, 1 to 5 */
  @Prop({ required: true, min: 1, max: 5 })
  starRating: number;

  /** e.g. ["wifi", "pool", "parking"], always lowercase */
  @Prop({ type: [String], default: [] })
  amenities: string[];

  /** GEN-08: at most 5 per hotel */
  @Prop({ type: [HotelPhotoSchema], default: [] })
  photos: HotelPhoto[];

  @Prop({ type: HotelPoliciesSchema, required: true })
  policies: HotelPolicies;

  /** Kept up to date by the reviews module (Member 5) through HotelsService.setRating(). 0 reviews = unrated. */
  @Prop({ default: 0, min: 0, max: 5 })
  averageRating: number;

  @Prop({ default: 0, min: 0 })
  reviewCount: number;

  /**
   * false = deactivated by an admin (Member 1). A deactivated hotel disappears from search
   * and cannot be booked, but existing bookings stay valid.
   */
  @Prop({ default: true, index: true })
  isActive: boolean;

  @Prop()
  deactivatedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const HotelSchema = SchemaFactory.createForClass(Hotel);
HotelSchema.index({ city: 1, isActive: 1 });
HotelSchema.index({ country: 1, isActive: 1 });
