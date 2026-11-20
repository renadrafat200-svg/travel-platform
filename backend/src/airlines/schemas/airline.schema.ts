import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AirlineDocument = HydratedDocument<Airline>;

/**
 * FLT-08: the airline's extra-baggage rules.
 * The FREE allowance (bag count and max kg per bag) is set per cabin on each flight (FLT-04);
 * each extra bag has the same max weight as that cabin's free bags. Prices are in USD (PAY-04).
 */
@Schema({ _id: false })
export class BaggagePolicy {
  /** Price of one extra bag, > 0 (Member 3 adds it to the booking total) */
  @Prop({ required: true, min: 0.01 })
  extraBagPrice: number;

  /** Maximum extra bags one passenger may add, >= 0 (0 = extra bags not sold) */
  @Prop({ required: true, min: 0 })
  maxExtraBags: number;

  @Prop({ trim: true, maxlength: 1000 })
  notes?: string;
}
const BaggagePolicySchema = SchemaFactory.createForClass(BaggagePolicy);

/**
 * FLT-09: one refund tier, e.g. { daysBeforeDeparture: 7, refundPercent: 100 }
 * means "cancel 7 or more days before departure and get 100% back".
 * Thresholds are unique whole numbers >= 0.
 */
@Schema({ _id: false })
export class CancellationRule {
  @Prop({ required: true, min: 0 })
  daysBeforeDeparture: number;

  @Prop({ required: true, min: 0, max: 100 })
  refundPercent: number;
}
const CancellationRuleSchema = SchemaFactory.createForClass(CancellationRule);

@Schema({ _id: false })
export class CancellationPolicy {
  /** Sorted from the most days to the fewest. If no tier applies the refund is 0%. */
  @Prop({ type: [CancellationRuleSchema], default: [] })
  rules: CancellationRule[];

  @Prop({ trim: true, maxlength: 1000 })
  notes?: string;
}
const CancellationPolicySchema =
  SchemaFactory.createForClass(CancellationPolicy);

@Schema({ timestamps: true })
export class Airline {
  _id: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 100 })
  name: string;

  /** 2-character IATA airline code, e.g. "MS" for EgyptAir. Unique and fixed after creation. */
  @Prop({ required: true, unique: true, uppercase: true, trim: true })
  iataCode: string;

  /** Home country, references the official Countries dataset (e.g. "EG") */
  @Prop({
    type: String,
    ref: 'Country',
    required: true,
    uppercase: true,
    index: true,
  })
  country: string;

  @Prop({ trim: true, maxlength: 2000 })
  description?: string;

  @Prop({ trim: true })
  logoUrl?: string;

  @Prop({ trim: true, lowercase: true })
  contactEmail?: string;

  @Prop({ trim: true })
  contactPhone?: string;

  @Prop({ trim: true })
  website?: string;

  @Prop({ type: BaggagePolicySchema, required: true })
  baggagePolicy: BaggagePolicy;

  @Prop({ type: CancellationPolicySchema, required: true })
  cancellationPolicy: CancellationPolicy;

  /**
   * false = deactivated by an admin (Member 1). A deactivated airline disappears from
   * public lists and flight search and cannot be booked, but existing bookings stay valid.
   */
  @Prop({ default: true, index: true })
  isActive: boolean;

  @Prop()
  deactivatedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const AirlineSchema = SchemaFactory.createForClass(Airline);
AirlineSchema.index({ name: 1 });
