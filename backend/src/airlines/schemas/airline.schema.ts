import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AirlineDocument = HydratedDocument<Airline>;

/** Allowance for one kind of bag, e.g. 1 cabin bag up to 7 kg */
@Schema({ _id: false })
export class BagAllowance {
  @Prop({ required: true, min: 0 })
  pieces: number;

  @Prop({ required: true, min: 0 })
  maxWeightKg: number;
}
const BagAllowanceSchema = SchemaFactory.createForClass(BagAllowance);

/** The airline's baggage rules, shown to travellers before they book */
@Schema({ _id: false })
export class BaggagePolicy {
  @Prop({ type: BagAllowanceSchema, required: true })
  cabin: BagAllowance;

  @Prop({ type: BagAllowanceSchema, required: true })
  checked: BagAllowance;

  /** Price of one extra checked bag (Member 3 uses this when a passenger adds bags) */
  @Prop({ required: true, min: 0 })
  extraBagFee: number;

  /** ISO 4217 currency of extraBagFee, from the official Countries dataset */
  @Prop({ required: true, uppercase: true })
  currency: string;

  @Prop({ trim: true, maxlength: 1000 })
  notes?: string;
}
const BaggagePolicySchema = SchemaFactory.createForClass(BaggagePolicy);

/**
 * One refund step, e.g. { hoursBeforeDeparture: 72, refundPercent: 100 }
 * means "cancel at least 72 hours before departure and get 100% back".
 */
@Schema({ _id: false })
export class CancellationRule {
  @Prop({ required: true, min: 0 })
  hoursBeforeDeparture: number;

  @Prop({ required: true, min: 0, max: 100 })
  refundPercent: number;
}
const CancellationRuleSchema = SchemaFactory.createForClass(CancellationRule);

@Schema({ _id: false })
export class CancellationPolicy {
  /** Sorted from the most hours to the fewest. Cancelling later than the last rule gives 0%. */
  @Prop({ type: [CancellationRuleSchema], default: [] })
  rules: CancellationRule[];

  @Prop({ trim: true, maxlength: 1000 })
  notes?: string;
}
const CancellationPolicySchema = SchemaFactory.createForClass(CancellationPolicy);

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
