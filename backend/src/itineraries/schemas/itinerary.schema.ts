import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { DAY_NOTES_MAX_LENGTH, TITLE_MAX_LENGTH } from '../itinerary.constants';

export type ItineraryDocument = HydratedDocument<Itinerary>;

/**
 * ITN-05: one day of the trip. The array order IS the day order, so the day number and
 * date are computed when the itinerary is returned (day 1 = startDate).
 */
@Schema({ _id: true })
export class ItineraryDay {
  _id: Types.ObjectId;

  /** City id from GET /api/cities (same list as hotels and airports) (ITN-09: required) */
  @Prop({ required: true, lowercase: true, trim: true })
  city: string;

  @Prop({ trim: true, maxlength: DAY_NOTES_MAX_LENGTH, default: '' })
  notes: string;
}
export const ItineraryDaySchema = SchemaFactory.createForClass(ItineraryDay);

/**
 * ITN-01: a trip plan. Days are embedded so the whole plan is one document: when an admin
 * deletes an itinerary through moderation (Member 1), nothing is left behind.
 *
 * Fields other modules rely on (do not rename):
 *   owner, title, countries, startDate, isPublic, isHidden, createdAt
 *   - Member 1's reports module sets isHidden / deletes by _id in the "itineraries" collection
 *   - Member 5's author page reads { owner, isPublic: true, isHidden != true }
 */
@Schema({ collection: 'itineraries', timestamps: true, optimisticConcurrency: true })
export class Itinerary {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  owner: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: TITLE_MAX_LENGTH })
  title: string;

  /** 2-letter codes from GET /api/countries */
  @Prop({ type: [String], required: true, index: true })
  countries: string[];

  /** Date of day 1 (UTC midnight) */
  @Prop({ required: true })
  startDate: Date;

  /** ITN-20: private by default; public itineraries appear in the shared search */
  @Prop({ default: false, index: true })
  isPublic: boolean;

  /** Set by an admin through the reports module. Hidden = visible only to the owner and admins. */
  @Prop({ default: false, index: true })
  isHidden: boolean;

  @Prop()
  hiddenAt?: Date;

  @Prop({ type: [ItineraryDaySchema], default: [] })
  days: Types.DocumentArray<ItineraryDay>;

  /** Kept in sync on every save, so public search can filter by duration (ITN-21) */
  @Prop({ default: 0, index: true })
  dayCount: number;

  /** Distinct city ids of the days, for search by city (ITN-21) */
  @Prop({ type: [String], default: [], index: true })
  cities: string[];

  createdAt: Date;
  updatedAt: Date;
}

export const ItinerarySchema = SchemaFactory.createForClass(Itinerary);

// ITN-03: my itineraries, most recently updated first
ItinerarySchema.index({ owner: 1, updatedAt: -1 });

ItinerarySchema.pre('save', function () {
  this.dayCount = this.days.length;
  this.cities = [...new Set(this.days.map((d) => d.city))];
});
