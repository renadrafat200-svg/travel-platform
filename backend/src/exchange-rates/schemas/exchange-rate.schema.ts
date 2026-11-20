import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';

export type ExchangeRateDocument = HydratedDocument<ExchangeRate>;

/**
 * ITN-18: one day's exchange rates from FXRatesAPI, cached in the shared database.
 * rates[X] = how many X one unit of the base currency buys, e.g. base USD, rates.EGP = 53.89.
 * If the API is down, the most recent day stored here is used.
 */
@Schema({ collection: 'exchangerates', versionKey: false })
export class ExchangeRate {
  @Prop({ required: true, uppercase: true })
  base: string;

  /** Date of the rates as given by the API, "YYYY-MM-DD" */
  @Prop({ required: true })
  date: string;

  @Prop({ type: SchemaTypes.Mixed, required: true })
  rates: Record<string, number>;

  @Prop({ required: true })
  fetchedAt: Date;
}

export const ExchangeRateSchema = SchemaFactory.createForClass(ExchangeRate);
// One document per base currency per day; the latest is found by date
ExchangeRateSchema.index({ base: 1, date: -1 }, { unique: true });
