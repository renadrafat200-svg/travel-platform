import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type FlightDocument = HydratedDocument<Flight>;

export enum CabinClass {
  ECONOMY = 'economy',
  PREMIUM_ECONOMY = 'premium_economy',
  BUSINESS = 'business',
  FIRST = 'first',
}

export enum FlightStatus {
  SCHEDULED = 'scheduled',
  CANCELLED = 'cancelled',
}

/** Ticket price per passenger type. Infants (under 2) sit on a lap and do not use a seat. */
@Schema({ _id: false })
export class CabinPrices {
  @Prop({ required: true, min: 0 })
  adult: number;

  @Prop({ required: true, min: 0 })
  child: number;

  @Prop({ required: true, min: 0 })
  infant: number;
}
const CabinPricesSchema = SchemaFactory.createForClass(CabinPrices);

/**
 * Cabin inventory (FLT-04). Embedded in the flight because it belongs to exactly one flight.
 *
 * FOR MEMBER 3 (seat holds, FLT-22): reserve seats with ONE atomic update so two people
 * can never get more seats than exist:
 *   flightModel.updateOne(
 *     { _id: flightId, status: 'scheduled',
 *       cabins: { $elemMatch: { _id: cabinId, availableSeats: { $gte: seats } } } },
 *     { $inc: { 'cabins.$.availableSeats': -seats } })
 * If modifiedCount is 0, there were not enough seats. Release with $inc: +seats.
 */
@Schema()
export class Cabin {
  _id: Types.ObjectId;

  @Prop({ type: String, enum: CabinClass, required: true })
  cabinClass: CabinClass;

  @Prop({ required: true, min: 1 })
  totalSeats: number;

  /** Seats not yet held or sold. Never below 0, never above totalSeats. */
  @Prop({ required: true, min: 0 })
  availableSeats: number;

  @Prop({ type: CabinPricesSchema, required: true })
  prices: CabinPrices;
}
export const CabinSchema = SchemaFactory.createForClass(Cabin);

@Schema({ timestamps: true })
export class Flight {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Airline', required: true, index: true })
  airline: Types.ObjectId;

  /** e.g. "MS777" */
  @Prop({ required: true, uppercase: true, trim: true })
  flightNumber: string;

  /** IATA code of the departure airport, references the official Airports dataset */
  @Prop({ type: String, ref: 'Airport', required: true })
  origin: string;

  @Prop({ type: String, ref: 'Airport', required: true })
  destination: string;

  /** Exact moments in UTC. Responses also show them in each airport's local time. */
  @Prop({ required: true })
  departureTime: Date;

  @Prop({ required: true })
  arrivalTime: Date;

  @Prop({ required: true, min: 1 })
  durationMinutes: number;

  /** Currency of all cabin prices, one of the supported currencies */
  @Prop({ required: true, uppercase: true })
  currency: string;

  @Prop({ type: [CabinSchema], default: [] })
  cabins: Types.DocumentArray<Cabin>;

  @Prop({ type: String, enum: FlightStatus, default: FlightStatus.SCHEDULED, index: true })
  status: FlightStatus;

  @Prop()
  cancelledAt?: Date;

  @Prop({ trim: true, maxlength: 500 })
  cancellationReason?: string;

  createdAt: Date;
  updatedAt: Date;
}

export const FlightSchema = SchemaFactory.createForClass(Flight);
// Main search index: route + date
FlightSchema.index({ origin: 1, destination: 1, departureTime: 1, status: 1 });
// The same flight number cannot depart twice at the same moment for one airline
FlightSchema.index({ airline: 1, flightNumber: 1, departureTime: 1 }, { unique: true });
