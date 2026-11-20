import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { existsSync } from 'fs';
import { Model } from 'mongoose';
import { join } from 'path';
import { readCsv } from './csv';
import { Airport, Attraction, City, Country } from './schemas/reference.schemas';

/**
 * Loads the official reference datasets from backend/data/*.csv into MongoDB on every start.
 * Uses "upsert" (insert or update by official id), so running it again never creates duplicates
 * and always matches the CSV files exactly.
 */
@Injectable()
export class ReferenceSeederService implements OnApplicationBootstrap {
  private readonly logger = new Logger('ReferenceSeeder');
  private readonly dataDir = join(process.cwd(), 'data');

  constructor(
    @InjectModel(Country.name) private readonly countries: Model<Country>,
    @InjectModel(City.name) private readonly cities: Model<City>,
    @InjectModel(Airport.name) private readonly airports: Model<Airport>,
    @InjectModel(Attraction.name) private readonly attractions: Model<Attraction>,
  ) {}

  async onApplicationBootstrap() {
    try {
      await this.seed();
    } catch (err) {
      this.logger.error(`Reference data NOT loaded: ${(err as Error).message}`);
    }
  }

  async seed() {
    const countryRows = this.load('Countries.csv');
    const cityRows = this.load('Cities.csv');
    const airportRows = this.load('Airports.csv');
    const attractionRows = this.load('Attractions.csv');

    // Check the files are consistent before writing anything
    const countryCodes = new Set(countryRows.map((r) => r.code));
    const cityIds = new Set(cityRows.map((r) => r.city_id));
    const problems: string[] = [];
    for (const c of cityRows) {
      if (!countryCodes.has(c.country_code)) problems.push(`City ${c.city_id}: unknown country ${c.country_code}`);
    }
    for (const a of airportRows) {
      if (!cityIds.has(a.city_id)) problems.push(`Airport ${a.iata_code}: unknown city ${a.city_id}`);
      if (!countryCodes.has(a.country_code)) problems.push(`Airport ${a.iata_code}: unknown country ${a.country_code}`);
      if (!isValidTimeZone(a.time_zone)) problems.push(`Airport ${a.iata_code}: invalid time zone ${a.time_zone}`);
    }
    for (const t of attractionRows) {
      if (!cityIds.has(t.city_id)) problems.push(`Attraction ${t.attraction_id}: unknown city ${t.city_id}`);
    }
    if (problems.length) throw new Error(`Invalid reference data:\n  - ${problems.join('\n  - ')}`);

    await this.upsertAll(this.countries, countryRows.map((r) => ({
      _id: r.code.toUpperCase(),
      name: r.name,
      currency: r.currency.toUpperCase(),
    })));
    await this.upsertAll(this.cities, cityRows.map((r) => ({
      _id: r.city_id,
      name: r.name,
      country: r.country_code.toUpperCase(),
    })));
    await this.upsertAll(this.airports, airportRows.map((r) => ({
      _id: r.iata_code.toUpperCase(),
      name: r.name,
      city: r.city_id,
      country: r.country_code.toUpperCase(),
      timeZone: r.time_zone,
    })));
    await this.upsertAll(this.attractions, attractionRows.map((r) => ({
      _id: r.attraction_id,
      name: r.name,
      city: r.city_id,
    })));

    this.logger.log(
      `Reference data loaded: ${countryRows.length} countries, ${cityRows.length} cities, ` +
        `${airportRows.length} airports, ${attractionRows.length} attractions`,
    );
  }

  private load(file: string) {
    const path = join(this.dataDir, file);
    if (!existsSync(path)) throw new Error(`Missing file backend/data/${file}`);
    return readCsv(path);
  }

  private async upsertAll<T>(model: Model<T>, docs: Array<{ _id: string } & Record<string, unknown>>) {
    if (docs.length === 0) return;
    await model.bulkWrite(
      docs.map(({ _id, ...fields }) => ({
        updateOne: { filter: { _id }, update: { $set: fields }, upsert: true },
      })) as never,
    );
  }
}

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
