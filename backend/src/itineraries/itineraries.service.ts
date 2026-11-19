import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Error as MongooseError, Model, Types } from 'mongoose';
import { paginate, PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { Role } from '../common/enums/role.enum';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { User } from '../users/schemas/user.schema';
import { budgetLines, sumAmounts } from './budget';
import {
  AddDayDto,
  CreateItineraryDto,
  ReorderDayDto,
  UpdateDayDto,
  UpdateItineraryDto,
} from './dto/itinerary.dto';
import {
  dayDate,
  MAX_DAYS,
  parseDate,
  toDateString,
  Visibility,
} from './itinerary.constants';
import { ActivityImageFile } from './schemas/activity-image-file.schema';
import { Itinerary, ItineraryDocument } from './schemas/itinerary.schema';

/** A run of consecutive days in the same city (ITN-09) */
export interface CityGroup {
  groupNumber: number;
  city: string;
  cityName: string;
  firstDay: number;
  lastDay: number;
  startDate: string;
  endDate: string;
  dayCount: number;
  dayIds: string[];
}

/**
 * Member 7: itineraries (ITN-01, ITN-03, ITN-05, ITN-07, ITN-08, ITN-09, ITN-20).
 * Private itineraries are only visible to their owner and admins; for anyone else they answer 404.
 */
@Injectable()
export class ItinerariesService {
  constructor(
    @InjectModel(Itinerary.name)
    private readonly itineraryModel: Model<Itinerary>,
    @InjectModel(ActivityImageFile.name)
    private readonly imageFileModel: Model<ActivityImageFile>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly reference: ReferenceDataService,
    private readonly exchangeRates: ExchangeRatesService,
  ) {}

  // =====================================================================================
  // Itinerary CRUD (ITN-01, ITN-03, ITN-20)
  // =====================================================================================

  async create(user: AuthUser, dto: CreateItineraryDto) {
    const itinerary = new this.itineraryModel({
      owner: new Types.ObjectId(user.id),
      title: dto.title,
      countries: await this.checkCountries(dto.countries),
      startDate: parseDate(dto.startDate, 'startDate'),
      isPublic: false,
    });
    await this.save(itinerary);
    return this.toDetail(itinerary);
  }

  /** ITN-03: my itineraries, most recently updated first */
  async listMine(user: AuthUser, query: PaginationQueryDto) {
    const filter = { owner: new Types.ObjectId(user.id) };
    const [docs, total] = await Promise.all([
      this.itineraryModel
        .find(filter)
        .select('-days')
        .sort({ updatedAt: -1, _id: -1 })
        .skip(query.skip)
        .limit(query.limit)
        .exec(),
      this.itineraryModel.countDocuments(filter).exec(),
    ]);
    return paginate(docs.map((d) => this.toSummary(d)), total, query);
  }

  /** ITN-03: full details of one of my itineraries */
  async findMine(user: AuthUser, id: string) {
    return this.toDetail(await this.getOwned(user, id));
  }

  async update(user: AuthUser, id: string, dto: UpdateItineraryDto) {
    if (Object.values(dto).every((v) => v === undefined)) {
      throw new BadRequestException('Nothing to change');
    }
    const itinerary = await this.getOwned(user, id);
    if (dto.title !== undefined) itinerary.title = dto.title;
    if (dto.countries !== undefined) {
      itinerary.countries = await this.checkCountries(dto.countries);
    }
    // ITN-05: every day's date follows the start date, so moving it moves the whole trip
    if (dto.startDate !== undefined) {
      itinerary.startDate = parseDate(dto.startDate, 'startDate');
    }
    // ITN-20: making it private removes it from the public search at once
    if (dto.visibility !== undefined) {
      itinerary.isPublic = dto.visibility === Visibility.PUBLIC;
    }
    await this.save(itinerary);
    return this.toDetail(itinerary);
  }

  /** ITN-01: clones made by other users are separate documents and are not affected */
  async remove(user: AuthUser, id: string) {
    const itinerary = await this.getOwned(user, id);
    await this.itineraryModel.deleteOne({ _id: itinerary._id }).exec();
    await this.imageFileModel.deleteMany({ itinerary: itinerary._id }).exec();
  }

  // =====================================================================================
  // Days (ITN-05, ITN-07, ITN-08, ITN-09)
  // =====================================================================================

  async addDay(user: AuthUser, id: string, dto: AddDayDto) {
    const itinerary = await this.getOwned(user, id);
    if (itinerary.days.length >= MAX_DAYS) {
      throw new BadRequestException(
        `An itinerary can have at most ${MAX_DAYS} days`,
      );
    }
    await this.checkCity(dto.city);
    const count = itinerary.days.length;
    const position = dto.position ?? count + 1;
    if (position > count + 1) {
      throw new BadRequestException(
        `position must be between 1 and ${count + 1}`,
      );
    }
    itinerary.days.splice(position - 1, 0, {
      city: dto.city,
      notes: dto.notes ?? '',
    } as never);
    await this.save(itinerary);
    return this.toDetail(itinerary);
  }

  async updateDay(user: AuthUser, id: string, dayId: string, dto: UpdateDayDto) {
    if (dto.city === undefined && dto.notes === undefined) {
      throw new BadRequestException('Nothing to change');
    }
    const itinerary = await this.getOwned(user, id);
    const day = this.findDay(itinerary, dayId);
    if (dto.city !== undefined) {
      await this.checkCity(dto.city);
      day.city = dto.city;
    }
    if (dto.notes !== undefined) day.notes = dto.notes;
    await this.save(itinerary);
    return this.toDetail(itinerary);
  }

  /**
   * ITN-07: the remaining days are renumbered and their dates and budget totals recalculated.
   * The day's activities, budget entries and the transport costs counted on it go with it.
   */
  async removeDay(user: AuthUser, id: string, dayId: string) {
    const itinerary = await this.getOwned(user, id);
    const day = this.findDay(itinerary, dayId);
    const activityIds = day.activities.map((a) => a._id);
    itinerary.days.pull(day._id);
    for (const t of itinerary.transportCosts.filter((t) => t.day.equals(day._id))) {
      itinerary.transportCosts.pull(t._id);
    }
    await this.save(itinerary);
    if (activityIds.length) {
      await this.imageFileModel.deleteMany({ activity: { $in: activityIds } }).exec();
    }
    return this.toDetail(itinerary);
  }

  /** ITN-08: move a day to a new position; numbers, dates and city groups follow */
  async reorderDay(user: AuthUser, id: string, dto: ReorderDayDto) {
    const itinerary = await this.getOwned(user, id);
    const from = itinerary.days.findIndex((d) => d._id.toString() === dto.dayId);
    if (from === -1) throw new NotFoundException('Day not found in this itinerary');
    if (dto.position > itinerary.days.length) {
      throw new BadRequestException(
        `position must be between 1 and ${itinerary.days.length}`,
      );
    }
    const days = itinerary.days.map((d) => d.toObject());
    const [moved] = days.splice(from, 1);
    days.splice(dto.position - 1, 0, moved);
    itinerary.set('days', days);
    await this.save(itinerary);
    return this.toDetail(itinerary);
  }

  // =====================================================================================
  // Views
  // =====================================================================================

  /** One row of "my itineraries" (ITN-03) */
  toSummary(doc: ItineraryDocument) {
    return {
      id: doc._id.toString(),
      title: doc.title,
      countries: doc.countries,
      startDate: toDateString(doc.startDate),
      endDate: dayDate(doc.startDate, Math.max(doc.dayCount - 1, 0)),
      days: doc.dayCount,
      visibility: doc.isPublic ? Visibility.PUBLIC : Visibility.PRIVATE,
      isHidden: doc.isHidden,
      updatedAt: doc.updatedAt,
    };
  }

  /**
   * Full itinerary: days with their number, date, activities and budget entries,
   * the intercity transport costs and the city groups. Day totals and group subtotals
   * (ITN-09) are converted to `currency` (default: the owner's preferred currency);
   * they are null when no exchange rates are available (ITN-18).
   */
  async toDetail(doc: ItineraryDocument, currency?: string) {
    const names = await this.cityNames();
    const displayCurrency =
      currency ?? (await this.preferredCurrency(doc.owner.toString()));
    const dayTotals = await this.convertedDayTotals(doc, displayCurrency);
    const dayNumber = new Map(doc.days.map((d, i) => [d._id.toString(), i + 1]));
    const days = doc.days.map((day, i) => ({
      id: day._id.toString(),
      dayNumber: i + 1,
      date: dayDate(doc.startDate, i),
      city: day.city,
      cityName: names.get(day.city) ?? day.city,
      notes: day.notes,
      // ITN-10: timed activities first, in time order; untimed ones after, as added
      activities: [...day.activities]
        .sort((a, b) => (a.time ?? '99:99').localeCompare(b.time ?? '99:99'))
        .map((a) => ({
          id: a._id.toString(),
          name: a.name,
          description: a.description,
          time: a.time ?? null,
          cost: a.cost ?? null,
          currency: a.currency ?? null,
          images: a.images.map((img) => ({ id: img._id.toString(), url: img.url })),
        })),
      budgets: day.budgets.map((b) => ({
        id: b._id.toString(),
        category: b.category,
        amount: b.amount,
        currency: b.currency,
        note: b.note,
      })),
      /** Budget entries + activity costs + transport of this day, converted */
      total: dayTotals.totals?.[i] ?? null,
    }));
    const groups = this.cityGroups(doc, names).map((g) => ({
      ...g,
      subtotal: dayTotals.totals
        ? sumAmounts(dayTotals.totals.slice(g.firstDay - 1, g.lastDay))
        : null,
    }));
    const transportCosts = doc.transportCosts.map((t) => ({
      id: t._id.toString(),
      mode: t.mode,
      fromCity: t.fromCity,
      toCity: t.toCity,
      amount: t.amount,
      currency: t.currency,
      dayId: t.day.toString(),
      dayNumber: dayNumber.get(t.day.toString()) ?? null,
      note: t.note,
    }));
    return {
      id: doc._id.toString(),
      owner: doc.owner.toString(),
      title: doc.title,
      countries: doc.countries,
      startDate: toDateString(doc.startDate),
      endDate: dayDate(doc.startDate, Math.max(doc.days.length - 1, 0)),
      dayCount: doc.days.length,
      visibility: doc.isPublic ? Visibility.PUBLIC : Visibility.PRIVATE,
      isHidden: doc.isHidden,
      days,
      transportCosts,
      groups,
      budget: {
        currency: displayCurrency,
        total: dayTotals.totals ? sumAmounts(dayTotals.totals) : null,
        rateDate: dayTotals.rateDate,
      },
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  /**
   * ITN-09: walk the days in order and start a new group whenever the city changes,
   * e.g. Cairo, Cairo, Luxor, Cairo -> [Cairo x2] [Luxor x1] [Cairo x1].
   */
  cityGroups(doc: ItineraryDocument, names: Map<string, string>): CityGroup[] {
    const groups: CityGroup[] = [];
    doc.days.forEach((day, i) => {
      const last = groups[groups.length - 1];
      if (last && last.city === day.city) {
        last.lastDay = i + 1;
        last.endDate = dayDate(doc.startDate, i);
        last.dayCount += 1;
        last.dayIds.push(day._id.toString());
      } else {
        groups.push({
          groupNumber: groups.length + 1,
          city: day.city,
          cityName: names.get(day.city) ?? day.city,
          firstDay: i + 1,
          lastDay: i + 1,
          startDate: dayDate(doc.startDate, i),
          endDate: dayDate(doc.startDate, i),
          dayCount: 1,
          dayIds: [day._id.toString()],
        });
      }
    });
    return groups;
  }

  // =====================================================================================
  // Helpers
  // =====================================================================================

  /** ACC-09: a user's preferred currency for budget totals, USD by default */
  async preferredCurrency(userId: string | undefined): Promise<string> {
    if (!userId || !Types.ObjectId.isValid(userId)) return 'USD';
    const user = await this.userModel
      .findById(userId)
      .select('preferences')
      .lean()
      .exec();
    return user?.preferences?.currency?.toUpperCase() || 'USD';
  }

  /** Each day's total in one currency, or totals: null if the rates are missing */
  private async convertedDayTotals(doc: ItineraryDocument, currency: string) {
    const lines = budgetLines(doc);
    const needsRates = lines.some((l) => l.currency !== currency);
    const rates = needsRates ? await this.exchangeRates.tryGetRates() : null;
    if (needsRates && !rates) return { totals: null, rateDate: null };
    try {
      const perDay = doc.days.map(() => [] as number[]);
      for (const l of lines) {
        perDay[l.dayIndex].push(
          rates
            ? this.exchangeRates.convert(l.amount, l.currency, currency, rates)
            : l.amount,
        );
      }
      return { totals: perDay.map(sumAmounts), rateDate: rates?.date ?? null };
    } catch {
      // a currency is missing from the cached rates
      return { totals: null, rateDate: rates?.date ?? null };
    }
  }

  /**
   * Loads an itinerary the current user may change: the owner or an admin.
   * A public itinerary of someone else is read-only (403); a private one does not exist for them (404).
   */
  async getOwned(
    user: AuthUser,
    id: string,
    label = 'Itinerary',
  ): Promise<ItineraryDocument> {
    const itinerary = await this.findById(id);
    if (this.isOwnerOrAdmin(user, itinerary)) return itinerary;
    if (itinerary.isPublic && !itinerary.isHidden) {
      throw new ForbiddenException(
        'This itinerary belongs to another user and is read-only. View it with GET /api/itineraries/public/{id} or clone it to make changes.',
      );
    }
    throw new NotFoundException(`${label} not found`);
  }

  async findById(id: string): Promise<ItineraryDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Itinerary not found');
    const itinerary = await this.itineraryModel.findById(id).exec();
    if (!itinerary) throw new NotFoundException('Itinerary not found');
    return itinerary;
  }

  isOwnerOrAdmin(user: AuthUser | undefined, itinerary: ItineraryDocument) {
    if (!user) return false;
    return user.role === Role.ADMIN || itinerary.owner.toString() === user.id;
  }

  findDay(itinerary: ItineraryDocument, dayId: string) {
    const day = Types.ObjectId.isValid(dayId) ? itinerary.days.id(dayId) : null;
    if (!day) throw new NotFoundException('Day not found in this itinerary');
    return day;
  }

  /** city id -> display name, e.g. "new_york" -> "New York" */
  async cityNames(): Promise<Map<string, string>> {
    const cities = await this.reference.listCities({});
    return new Map(cities.map((c) => [c.id, c.name]));
  }

  async checkCity(city: string) {
    if (!(await this.reference.findCity(city))) {
      throw new BadRequestException(`Unknown city ${city}. See GET /api/cities`);
    }
  }

  private async checkCountries(codes: string[]): Promise<string[]> {
    const unique = [...new Set(codes)];
    for (const code of unique) {
      if (!(await this.reference.findCountry(code))) {
        throw new BadRequestException(
          `Unknown country ${code}. See GET /api/countries`,
        );
      }
    }
    return unique;
  }

  /** Saves, turning a parallel edit of the same itinerary into a clear 409 */
  async save(itinerary: ItineraryDocument) {
    try {
      await itinerary.save();
    } catch (err) {
      if (err instanceof MongooseError.VersionError) {
        throw new ConflictException(
          'This itinerary was changed at the same time by another request. Reload it and try again.',
        );
      }
      throw err;
    }
  }
}
