import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  ACTIVITY_DESCRIPTION_MAX_LENGTH,
  ACTIVITY_NAME_MAX_LENGTH,
  BudgetCategory,
  DAY_NOTES_MAX_LENGTH,
  NOTE_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  TransportMode,
} from '../itinerary.constants';

export type ItineraryDocument = HydratedDocument<Itinerary>;

/** ITN-12: an activity image. The bytes live in the activityimagefiles collection. */
@Schema({ _id: true, timestamps: { createdAt: 'uploadedAt', updatedAt: false } })
export class ActivityImage {
  _id: Types.ObjectId;

  @Prop({ required: true })
  fileName: string;

  @Prop({ required: true })
  url: string;

  @Prop({ required: true })
  contentType: string;

  @Prop({ required: true })
  size: number;

  uploadedAt: Date;
}
export const ActivityImageSchema = SchemaFactory.createForClass(ActivityImage);

/** ITN-10: something planned on a day */
@Schema({ _id: true })
export class Activity {
  _id: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: ACTIVITY_NAME_MAX_LENGTH })
  name: string;

  @Prop({ trim: true, maxlength: ACTIVITY_DESCRIPTION_MAX_LENGTH, default: '' })
  description: string;

  /** Optional local time "HH:mm" */
  @Prop()
  time?: string;

  /** Optional cost; counted under the "activities" budget category (ITN-14) */
  @Prop({ min: 0 })
  cost?: number;

  /** Currency of the cost */
  @Prop({ uppercase: true })
  currency?: string;

  @Prop({ type: [ActivityImageSchema], default: [] })
  images: Types.DocumentArray<ActivityImage>;
}
export const ActivitySchema = SchemaFactory.createForClass(Activity);

/** ITN-14: a planned expense of a day, in any supported currency */
@Schema({ _id: true })
export class BudgetEntry {
  _id: Types.ObjectId;

  @Prop({ type: String, enum: BudgetCategory, required: true })
  category: BudgetCategory;

  @Prop({ required: true, min: 0 })
  amount: number;

  @Prop({ required: true, uppercase: true })
  currency: string;

  @Prop({ trim: true, maxlength: NOTE_MAX_LENGTH, default: '' })
  note: string;
}
export const BudgetEntrySchema = SchemaFactory.createForClass(BudgetEntry);

/** ITN-16: getting from one city to another, booked on a given day */
@Schema({ _id: true })
export class TransportCost {
  _id: Types.ObjectId;

  @Prop({ type: String, enum: TransportMode, required: true })
  mode: TransportMode;

  @Prop({ required: true, lowercase: true })
  fromCity: string;

  @Prop({ required: true, lowercase: true })
  toCity: string;

  @Prop({ required: true, min: 0 })
  amount: number;

  @Prop({ required: true, uppercase: true })
  currency: string;

  /** The day it is counted on (removed together with that day) */
  @Prop({ type: Types.ObjectId, required: true })
  day: Types.ObjectId;

  @Prop({ trim: true, maxlength: NOTE_MAX_LENGTH, default: '' })
  note: string;
}
export const TransportCostSchema = SchemaFactory.createForClass(TransportCost);

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

  @Prop({ type: [ActivitySchema], default: [] })
  activities: Types.DocumentArray<Activity>;

  @Prop({ type: [BudgetEntrySchema], default: [] })
  budgets: Types.DocumentArray<BudgetEntry>;
}
export const ItineraryDaySchema = SchemaFactory.createForClass(ItineraryDay);

/** ITN-27 (optional): one of the owner's confirmed flight or hotel bookings, attached to the plan */
@Schema({ _id: true })
export class AttachedBooking {
  _id: Types.ObjectId;

  @Prop({ type: String, enum: ['flight', 'hotel'], required: true })
  bookingType: 'flight' | 'hotel';

  @Prop({ type: Types.ObjectId, required: true })
  booking: Types.ObjectId;

  @Prop({ required: true })
  attachedAt: Date;
}
export const AttachedBookingSchema = SchemaFactory.createForClass(AttachedBooking);

/** ITN-21: where a clone came from; it credits the original author */
@Schema({ _id: false })
export class ClonedFrom {
  @Prop({ type: Types.ObjectId, required: true })
  itinerary: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  author: Types.ObjectId;

  /** Kept as text so the credit stays even if the original is deleted */
  @Prop({ required: true })
  authorName: string;

  @Prop({ required: true })
  title: string;
}
export const ClonedFromSchema = SchemaFactory.createForClass(ClonedFrom);

/**
 * ITN-01: a trip plan. Days (with their activities and budgets) and transport costs are
 * embedded so the whole plan is one document: when an admin
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

  @Prop({ type: [TransportCostSchema], default: [] })
  transportCosts: Types.DocumentArray<TransportCost>;

  /** Kept in sync on every save, so public search can filter by duration (ITN-21) */
  @Prop({ default: 0, index: true })
  dayCount: number;

  /** Distinct city ids of the days, for search by city (ITN-21) */
  @Prop({ type: [String], default: [], index: true })
  cities: string[];

  /** ITN-27 (optional): the owner's own bookings attached to this plan. Never copied to clones, never shown to others. */
  @Prop({ type: [AttachedBookingSchema], default: [] })
  attachedBookings: Types.DocumentArray<AttachedBooking>;

  /** ITN-21: set on clones. The clone is independent; this is only the credit. */
  @Prop({ type: ClonedFromSchema })
  clonedFrom?: ClonedFrom;

  createdAt: Date;
  updatedAt: Date;
}

export const ItinerarySchema = SchemaFactory.createForClass(Itinerary);

// ITN-03: my itineraries, most recently updated first
ItinerarySchema.index({ owner: 1, updatedAt: -1 });
// PATCH/DELETE /api/activities/:id, /api/budgets/:id, /api/transport-costs/:id find their itinerary
ItinerarySchema.index({ 'days.activities._id': 1 });
ItinerarySchema.index({ 'days.budgets._id': 1 });
ItinerarySchema.index({ 'transportCosts._id': 1 });
// ITN-21: public search, newest first
ItinerarySchema.index({ isPublic: 1, isHidden: 1, updatedAt: -1 });

ItinerarySchema.pre('save', function () {
  this.dayCount = this.days.length;
  this.cities = [...new Set(this.days.map((d) => d.city))];
});
