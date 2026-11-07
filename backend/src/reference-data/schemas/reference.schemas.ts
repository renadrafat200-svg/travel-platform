import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/**
 * Reference data loaded from the official CSV files in backend/data.
 * The official identifiers are used as _id (e.g. "EG", "cairo", "CAI", "att-1"),
 * so every team's database uses exactly the same ids, as the project requires.
 */

@Schema({ collection: 'countries', versionKey: false })
export class Country {
  /** ISO country code, e.g. "EG" */
  @Prop({ type: String })
  _id: string;

  @Prop({ required: true })
  name: string;

  /** ISO 4217 currency code, e.g. "EGP". The supported currencies are exactly these. */
  @Prop({ required: true, uppercase: true, index: true })
  currency: string;
}
export const CountrySchema = SchemaFactory.createForClass(Country);

@Schema({ collection: 'cities', versionKey: false })
export class City {
  /** Official city id, e.g. "cairo", "new_york" */
  @Prop({ type: String })
  _id: string;

  @Prop({ required: true })
  name: string;

  /** Country code, references Country._id */
  @Prop({ type: String, ref: 'Country', required: true, index: true })
  country: string;
}
export const CitySchema = SchemaFactory.createForClass(City);

@Schema({ collection: 'airports', versionKey: false })
export class Airport {
  /** IATA code, e.g. "CAI" */
  @Prop({ type: String })
  _id: string;

  @Prop({ required: true })
  name: string;

  @Prop({ type: String, ref: 'City', required: true, index: true })
  city: string;

  @Prop({ type: String, ref: 'Country', required: true, index: true })
  country: string;

  /** IANA time zone, e.g. "Africa/Cairo". Used to show local departure/arrival times. */
  @Prop({ required: true })
  timeZone: string;
}
export const AirportSchema = SchemaFactory.createForClass(Airport);

@Schema({ collection: 'attractions', versionKey: false })
export class Attraction {
  /** Official attraction id, e.g. "att-1" */
  @Prop({ type: String })
  _id: string;

  @Prop({ required: true })
  name: string;

  @Prop({ type: String, ref: 'City', required: true, index: true })
  city: string;
}
export const AttractionSchema = SchemaFactory.createForClass(Attraction);
