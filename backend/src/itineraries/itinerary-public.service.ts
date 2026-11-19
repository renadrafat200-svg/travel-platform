import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { plainToInstance } from 'class-transformer';
import { randomUUID } from 'crypto';
import { Model, QueryFilter, Types } from 'mongoose';
import { paginate } from '../common/dto/pagination-query.dto';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import { FlightSearchDto } from '../flights/dto/flight-search.dto';
import { FlightSearchService } from '../flights/flight-search.service';
import { HotelSearchDto } from '../hotels/dto/hotel.dto';
import { HotelSearchService } from '../hotels/hotel-search.service';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { User } from '../users/schemas/user.schema';
import {
  ItineraryFlightsQueryDto,
  ItineraryHotelsQueryDto,
  PublicSearchQueryDto,
} from './dto/itinerary-public.dto';
import { ItinerariesService } from './itineraries.service';
import { dayDate, parseDate, toDateString } from './itinerary.constants';
import { ActivityImageFile } from './schemas/activity-image-file.schema';
import { Itinerary } from './schemas/itinerary.schema';

/**
 * Member 7: shared itineraries (ITN-20, ITN-21), cloning, and hotel / flight search
 * from an itinerary (ITN-25, ITN-26).
 * Public = isPublic and not hidden by an admin. Guests may search and view; cloning needs login.
 */
@Injectable()
export class ItineraryPublicService {
  constructor(
    @InjectModel(Itinerary.name)
    private readonly itineraryModel: Model<Itinerary>,
    @InjectModel(ActivityImageFile.name)
    private readonly imageFileModel: Model<ActivityImageFile>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly itineraries: ItinerariesService,
    private readonly reference: ReferenceDataService,
    private readonly exchangeRates: ExchangeRatesService,
    private readonly hotelSearch: HotelSearchService,
    private readonly flightSearch: FlightSearchService,
  ) {}

  // =====================================================================================
  // Search and view (ITN-20, ITN-21)
  // =====================================================================================

  /** Public itineraries by keyword (title, country or city), duration, country and city */
  async search(q: PublicSearchQueryDto) {
    if (q.minDays !== undefined && q.maxDays !== undefined && q.minDays > q.maxDays) {
      throw new BadRequestException('minDays cannot be greater than maxDays');
    }
    const filter: QueryFilter<Itinerary> = {
      isPublic: true,
      isHidden: { $ne: true },
    };
    if (q.country) filter.countries = q.country;
    if (q.city) filter.cities = q.city;
    if (q.minDays !== undefined || q.maxDays !== undefined) {
      filter.dayCount = {
        ...(q.minDays !== undefined && { $gte: q.minDays }),
        ...(q.maxDays !== undefined && { $lte: q.maxDays }),
      };
    }
    if (q.keyword) filter.$or = await this.keywordFilter(q.keyword);

    const [docs, total] = await Promise.all([
      this.itineraryModel
        .find(filter)
        .select('-days -transportCosts')
        .sort({ updatedAt: -1, _id: -1 })
        .skip(q.skip)
        .limit(q.limit)
        .exec(),
      this.itineraryModel.countDocuments(filter).exec(),
    ]);
    const authors = await this.authorNames(docs.map((d) => d.owner));
    const items = docs.map((d) => ({
      id: d._id.toString(),
      title: d.title,
      countries: d.countries,
      cities: d.cities,
      startDate: toDateString(d.startDate),
      endDate: dayDate(d.startDate, Math.max(d.dayCount - 1, 0)),
      days: d.dayCount,
      author: { id: d.owner.toString(), name: authors.get(d.owner.toString()) ?? 'Unknown' },
      clonedFrom: this.itineraries.clonedFromView(d),
      updatedAt: d.updatedAt,
    }));
    return paginate(items, total, q as never);
  }

  /** Read-only view with author, days, activities and budget (ITN-21) */
  async view(viewer: AuthUser | undefined, id: string, currency?: string) {
    const itinerary = await this.findReadable(viewer, id);
    const display = currency
      ? await this.exchangeRates.assertSupported(currency)
      : await this.itineraries.preferredCurrency(viewer?.id);
    const detail = await this.itineraries.toDetail(itinerary, display);
    const authors = await this.authorNames([itinerary.owner]);
    return {
      ...detail,
      author: {
        id: itinerary.owner.toString(),
        name: authors.get(itinerary.owner.toString()) ?? 'Unknown',
      },
      readOnly: !this.itineraries.isOwnerOrAdmin(viewer, itinerary),
    };
  }

  // =====================================================================================
  // Clone (ITN-21)
  // =====================================================================================

  /**
   * Deep copy into a NEW private itinerary owned by the user: days, activities (with their
   * images), budgets and transport costs get new ids, so later changes to either side never
   * affect the other. The clone credits the original author.
   */
  async clone(user: AuthUser, id: string) {
    const source = await this.findReadable(user, id);
    const authors = await this.authorNames([source.owner]);
    const newId = new Types.ObjectId();
    const dayIds = new Map<string, Types.ObjectId>();
    const fileCopies: { from: string; to: string; activity: Types.ObjectId }[] = [];

    const days = source.days.map((day) => {
      const newDayId = new Types.ObjectId();
      dayIds.set(day._id.toString(), newDayId);
      return {
        _id: newDayId,
        city: day.city,
        notes: day.notes,
        activities: day.activities.map((a) => {
          const activityId = new Types.ObjectId();
          return {
            _id: activityId,
            name: a.name,
            description: a.description,
            time: a.time,
            cost: a.cost,
            currency: a.currency,
            images: a.images.map((img) => {
              const ext = img.fileName.split('.').pop();
              const fileName = `${activityId.toString()}-${randomUUID()}.${ext}`;
              fileCopies.push({ from: img.fileName, to: fileName, activity: activityId });
              return {
                _id: new Types.ObjectId(),
                fileName,
                url: `/api/activities/images/${fileName}`,
                contentType: img.contentType,
                size: img.size,
              };
            }),
          };
        }),
        budgets: day.budgets.map((b) => ({
          _id: new Types.ObjectId(),
          category: b.category,
          amount: b.amount,
          currency: b.currency,
          note: b.note,
        })),
      };
    });
    const transportCosts = source.transportCosts
      .filter((t) => dayIds.has(t.day.toString()))
      .map((t) => ({
        _id: new Types.ObjectId(),
        mode: t.mode,
        fromCity: t.fromCity,
        toCity: t.toCity,
        amount: t.amount,
        currency: t.currency,
        day: dayIds.get(t.day.toString()),
        note: t.note,
      }));

    // Image bytes are copied too, so deleting an image on one side leaves the other intact
    const copied = await this.copyImageFiles(fileCopies, newId);
    const clone = new this.itineraryModel({
      _id: newId,
      owner: new Types.ObjectId(user.id),
      title: source.title,
      countries: source.countries,
      startDate: source.startDate,
      isPublic: false,
      isHidden: false,
      days,
      transportCosts,
      clonedFrom: {
        itinerary: source._id,
        author: source.owner,
        authorName: authors.get(source.owner.toString()) ?? 'Unknown',
        title: source.title,
      },
    });
    try {
      await this.itineraries.save(clone);
    } catch (err) {
      await this.imageFileModel.deleteMany({ fileName: { $in: copied } }).exec();
      throw err;
    }
    return this.itineraries.toDetail(clone);
  }

  // =====================================================================================
  // Hotels and flights from the itinerary (ITN-25, ITN-26)
  // =====================================================================================

  /**
   * ITN-25: hotels in a city group's city for the group's dates:
   * check-in = the group's first day, check-out = the day after its last day.
   * Reuses hotel search (HTL-11).
   */
  async hotels(viewer: AuthUser, id: string, q: ItineraryHotelsQueryDto) {
    const itinerary = await this.findReadable(viewer, id);
    if (!itinerary.days.length) {
      throw new BadRequestException('Add at least one day to the itinerary first');
    }
    const groups = this.itineraries.cityGroups(itinerary, await this.itineraries.cityNames());
    let group = groups[0];
    if (q.dayId) {
      const found = groups.find((g) => g.dayIds.includes(q.dayId!));
      if (!found) throw new NotFoundException('Day not found in this itinerary');
      group = found;
    } else if (q.groupIndex !== undefined) {
      if (q.groupIndex > groups.length) {
        throw new BadRequestException(
          `groupIndex must be between 1 and ${groups.length} (see "groups" in the itinerary)`,
        );
      }
      group = groups[q.groupIndex - 1];
    }
    const checkIn = group.startDate;
    const checkOut = dayDate(parseDate(group.endDate), 1);
    const search = plainToInstance(HotelSearchDto, {
      city: group.city,
      checkIn,
      checkOut,
      guests: q.guests,
      rooms: q.rooms,
      page: q.page,
      limit: q.limit,
    });
    return {
      group,
      checkIn,
      checkOut,
      guests: q.guests,
      rooms: q.rooms,
      hotels: await this.hotelSearch.search(search),
    };
  }

  /**
   * ITN-26: flights from an origin airport to any airport in the city of the FIRST day.
   * Outbound defaults to the start date; a round trip returns on the last day's date.
   * Reuses flight search (FLT-11, FLT-12).
   */
  async flights(viewer: AuthUser, id: string, q: ItineraryFlightsQueryDto) {
    const itinerary = await this.findReadable(viewer, id);
    if (!itinerary.days.length) {
      throw new BadRequestException('Add at least one day to the itinerary first');
    }
    const city = itinerary.days[0].city;
    const airports = (await this.reference.listAirports({ city })).filter(
      (a) => a.iataCode !== q.from,
    );
    if (!airports.length) {
      throw new NotFoundException(
        `There is no other airport in ${city} (the city of day 1) to fly to`,
      );
    }
    if (q.tripType === 'one_way' && q.returnDate) {
      throw new BadRequestException('A one-way search has no returnDate');
    }
    const departureDate = q.departureDate ?? toDateString(itinerary.startDate);
    const returnDate =
      q.tripType === 'round_trip'
        ? (q.returnDate ?? dayDate(itinerary.startDate, itinerary.days.length - 1))
        : undefined;
    parseDate(departureDate, 'departureDate');
    if (returnDate) parseDate(returnDate, 'returnDate');

    const results = [];
    for (const airport of airports) {
      const search = plainToInstance(FlightSearchDto, {
        from: q.from,
        to: airport.iataCode,
        departureDate,
        returnDate,
        adults: q.adults,
        children: q.children,
        infants: q.infants,
        cabinClass: q.cabinClass,
        page: q.page,
        limit: q.limit,
      });
      results.push({ to: airport.iataCode, airport: airport.name, ...(await this.flightSearch.search(search)) });
    }
    return {
      tripType: q.tripType,
      from: q.from,
      destinationCity: city,
      departureDate,
      returnDate: returnDate ?? null,
      results,
    };
  }

  // =====================================================================================
  // Helpers
  // =====================================================================================

  /** Public and not hidden, or the viewer's own (or an admin) */
  private async findReadable(viewer: AuthUser | undefined, id: string) {
    const itinerary = await this.itineraries.findById(id);
    if (this.itineraries.isOwnerOrAdmin(viewer, itinerary)) return itinerary;
    if (itinerary.isPublic && !itinerary.isHidden) return itinerary;
    throw new NotFoundException('Itinerary not found');
  }

  /** "egypt" also finds itineraries in EG; "new york" finds those with a day in new_york */
  private async keywordFilter(keyword: string): Promise<QueryFilter<Itinerary>[]> {
    const re = new RegExp(escapeRegex(keyword), 'i');
    const [countries, cities] = await Promise.all([
      this.reference.listCountries(),
      this.reference.listCities({}),
    ]);
    const countryCodes = countries
      .filter((c) => re.test(c.code) || re.test(c.name))
      .map((c) => c.code);
    const cityIds = cities.filter((c) => re.test(c.id) || re.test(c.name)).map((c) => c.id);
    return [
      { title: re },
      ...(countryCodes.length ? [{ countries: { $in: countryCodes } }] : []),
      ...(cityIds.length ? [{ cities: { $in: cityIds } }] : []),
    ];
  }

  private async authorNames(ids: Types.ObjectId[]): Promise<Map<string, string>> {
    const users = await this.userModel
      .find({ _id: { $in: ids } })
      .select('firstName lastName')
      .lean()
      .exec();
    return new Map(
      users.map((u) => [u._id.toString(), `${u.firstName} ${u.lastName}`.trim()]),
    );
  }

  /** Copies image files under new names; returns the new names */
  private async copyImageFiles(
    copies: { from: string; to: string; activity: Types.ObjectId }[],
    itineraryId: Types.ObjectId,
  ): Promise<string[]> {
    if (!copies.length) return [];
    const files = await this.imageFileModel
      .find({ fileName: { $in: copies.map((c) => c.from) } })
      .lean()
      .exec();
    const byName = new Map(files.map((f) => [f.fileName, f]));
    const docs = copies
      .filter((c) => byName.has(c.from))
      .map((c) => {
        const f = byName.get(c.from)!;
        return {
          fileName: c.to,
          itinerary: itineraryId,
          activity: c.activity,
          contentType: f.contentType,
          size: f.size,
          data: f.data,
        };
      });
    if (docs.length) await this.imageFileModel.insertMany(docs);
    return docs.map((d) => d.fileName);
  }
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
