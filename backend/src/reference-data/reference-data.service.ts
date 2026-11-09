import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AirportQueryDto, AttractionQueryDto, CityQueryDto } from './dto/reference-query.dto';
import { Airport, Attraction, City, Country } from './schemas/reference.schemas';

/**
 * Read access to the reference data. Other modules can inject this service, e.g.
 *   - Flights: findAirport('CAI') to check an airport exists and get its time zone
 *   - Itineraries / budgets: isSupportedCurrency('EGP')
 *   - Hotels: findCity('cairo')
 */
@Injectable()
export class ReferenceDataService {
  constructor(
    @InjectModel(Country.name) private readonly countries: Model<Country>,
    @InjectModel(City.name) private readonly cities: Model<City>,
    @InjectModel(Airport.name) private readonly airports: Model<Airport>,
    @InjectModel(Attraction.name) private readonly attractions: Model<Attraction>,
  ) {}

  /** FLT-02: list airports, optionally searched or filtered */
  async listAirports(q: AirportQueryDto) {
    const filter: Record<string, unknown> = {};
    if (q.city) filter.city = q.city.toLowerCase();
    if (q.country) filter.country = q.country.toUpperCase();
    if (q.search) {
      const re = new RegExp(escapeRegex(q.search), 'i');
      filter.$or = [{ _id: re }, { name: re }, { city: re }];
    }
    const docs = await this.airports.find(filter).sort({ _id: 1 }).lean().exec();
    return docs.map(toAirportView);
  }

  async listCountries() {
    const docs = await this.countries.find().sort({ name: 1 }).lean().exec();
    return docs.map((d) => ({ code: d._id, name: d.name, currency: d.currency }));
  }

  async listCities(q: CityQueryDto) {
    const filter = q.country ? { country: q.country.toUpperCase() } : {};
    const docs = await this.cities.find(filter).sort({ name: 1 }).lean().exec();
    return docs.map((d) => ({ id: d._id, name: d.name, countryCode: d.country }));
  }

  async listAttractions(q: AttractionQueryDto) {
    const filter = q.city ? { city: q.city.toLowerCase() } : {};
    const docs = await this.attractions.find(filter).sort({ name: 1 }).lean().exec();
    return docs.map((d) => ({ id: d._id, name: d.name, cityId: d.city }));
  }

  // ---- helpers for other modules ----

  async findAirport(iataCode: string) {
    const doc = await this.airports.findById(iataCode.toUpperCase()).lean().exec();
    return doc ? toAirportView(doc) : null;
  }

  async findCountry(code: string) {
    return this.countries.findById(code.toUpperCase()).lean().exec();
  }

  async findCity(cityId: string) {
    return this.cities.findById(cityId.toLowerCase()).lean().exec();
  }

  async isSupportedCurrency(code: string): Promise<boolean> {
    return !!(await this.countries.exists({ currency: code.toUpperCase() }));
  }

  async supportedCurrencies(): Promise<string[]> {
    const codes = await this.countries.distinct('currency').exec();
    return (codes as string[]).sort();
  }
}

function toAirportView(d: Airport) {
  return { iataCode: d._id, name: d.name, cityId: d.city, countryCode: d.country, timeZone: d.timeZone };
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
