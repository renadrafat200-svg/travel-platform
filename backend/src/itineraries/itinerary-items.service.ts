import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import { Model, Types } from 'mongoose';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import { UploadedImage, validateImages } from '../common/utils/image-upload';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import {
  CreateActivityDto,
  CreateBudgetDto,
  CreateTransportCostDto,
  UpdateActivityDto,
  UpdateBudgetDto,
  UpdateTransportCostDto,
} from './dto/itinerary-items.dto';
import { BudgetLine, budgetLines, round2, sumAmounts } from './budget';
import { ItinerariesService } from './itineraries.service';
import {
  dayDate,
  MAX_ACTIVITY_IMAGES,
  SUMMARY_CATEGORIES,
} from './itinerary.constants';
import { ActivityImageFile } from './schemas/activity-image-file.schema';
import { Itinerary, ItineraryDocument } from './schemas/itinerary.schema';

/**
 * Member 7: activities and their images (ITN-10, ITN-12), budget entries (ITN-14),
 * intercity transport costs (ITN-16) and the budget summary.
 * Every change is checked against the itinerary owner (or an admin).
 */
@Injectable()
export class ItineraryItemsService {
  constructor(
    @InjectModel(Itinerary.name)
    private readonly itineraryModel: Model<Itinerary>,
    @InjectModel(ActivityImageFile.name)
    private readonly imageFileModel: Model<ActivityImageFile>,
    private readonly itineraries: ItinerariesService,
    private readonly reference: ReferenceDataService,
    private readonly exchangeRates: ExchangeRatesService,
  ) {}

  // =====================================================================================
  // Activities (ITN-10)
  // =====================================================================================

  async addActivity(
    user: AuthUser,
    id: string,
    dayId: string,
    dto: CreateActivityDto,
  ) {
    const itinerary = await this.itineraries.getOwned(user, id);
    const day = this.itineraries.findDay(itinerary, dayId);
    const currency =
      dto.cost !== undefined
        ? await this.checkCurrency(dto.currency ?? (await this.preferredCurrency(user)))
        : dto.currency && (await this.checkCurrency(dto.currency));
    day.activities.push({
      name: dto.name,
      description: dto.description ?? '',
      time: dto.time,
      cost: dto.cost,
      currency: currency || undefined,
    });
    await this.itineraries.save(itinerary);
    return this.itineraries.toDetail(itinerary);
  }

  async updateActivity(user: AuthUser, activityId: string, dto: UpdateActivityDto) {
    if (Object.values(dto).every((v) => v === undefined)) {
      throw new BadRequestException('Nothing to change');
    }
    const { itinerary, activity } = await this.findActivity(user, activityId);
    if (dto.name !== undefined) activity.name = dto.name;
    if (dto.description !== undefined) activity.description = dto.description;
    if (dto.time !== undefined) activity.time = dto.time ?? undefined;
    if (dto.cost !== undefined) activity.cost = dto.cost ?? undefined;
    if (dto.currency !== undefined) {
      activity.currency = await this.checkCurrency(dto.currency);
    }
    // A cost always needs a currency to be converted (ITN-18)
    if (activity.cost !== undefined && activity.cost !== null && !activity.currency) {
      activity.currency = await this.preferredCurrency(user);
    }
    await this.itineraries.save(itinerary);
    return this.itineraries.toDetail(itinerary);
  }

  async removeActivity(user: AuthUser, activityId: string) {
    const { itinerary, day, activity } = await this.findActivity(user, activityId);
    day.activities.pull(activity._id);
    await this.itineraries.save(itinerary);
    await this.imageFileModel.deleteMany({ activity: activity._id }).exec();
    return this.itineraries.toDetail(itinerary);
  }

  // =====================================================================================
  // Activity images (ITN-12, GEN-08)
  // =====================================================================================

  async addImages(user: AuthUser, activityId: string, files: UploadedImage[]) {
    const { itinerary, activity } = await this.findActivity(user, activityId);
    const checked = validateImages(
      files,
      activity.images.length,
      MAX_ACTIVITY_IMAGES,
    );
    const newFiles = checked.map(({ file, type, extension }) => ({
      fileName: `${activity._id.toString()}-${randomUUID()}.${extension}`,
      itinerary: itinerary._id,
      activity: activity._id,
      contentType: type,
      size: file.size,
      data: file.buffer,
    }));
    await this.imageFileModel.insertMany(newFiles);
    for (const f of newFiles) {
      activity.images.push({
        fileName: f.fileName,
        url: `/api/activities/images/${f.fileName}`,
        contentType: f.contentType,
        size: f.size,
      });
    }
    try {
      // optimistic concurrency: two uploads at the same time cannot pass the limit of 5
      await this.itineraries.save(itinerary);
    } catch (err) {
      await this.imageFileModel
        .deleteMany({ fileName: { $in: newFiles.map((f) => f.fileName) } })
        .exec();
      throw err;
    }
    return this.imageViews(activity.images);
  }

  async removeImage(user: AuthUser, activityId: string, imageId: string) {
    const { itinerary, activity } = await this.findActivity(user, activityId);
    const image = Types.ObjectId.isValid(imageId)
      ? activity.images.id(imageId)
      : null;
    if (!image) throw new NotFoundException('Image not found on this activity');
    activity.images.pull(image._id);
    await this.itineraries.save(itinerary);
    await this.imageFileModel.deleteOne({ fileName: image.fileName }).exec();
    return this.imageViews(activity.images);
  }

  /** GET /api/activities/images/:fileName: the image bytes */
  async imageFile(fileName: string) {
    if (!/^[a-f0-9]{24}-[a-f0-9-]{36}\.(jpg|png)$/.test(fileName)) {
      throw new NotFoundException('Image not found');
    }
    const file = await this.imageFileModel.findOne({ fileName }).exec();
    if (!file) throw new NotFoundException('Image not found');
    return { data: file.data, contentType: file.contentType };
  }

  // =====================================================================================
  // Budget entries (ITN-14)
  // =====================================================================================

  async addBudget(user: AuthUser, id: string, dayId: string, dto: CreateBudgetDto) {
    const itinerary = await this.itineraries.getOwned(user, id);
    const day = this.itineraries.findDay(itinerary, dayId);
    day.budgets.push({
      category: dto.category,
      amount: dto.amount,
      currency: await this.checkCurrency(dto.currency),
      note: dto.note ?? '',
    });
    await this.itineraries.save(itinerary);
    return this.itineraries.toDetail(itinerary);
  }

  async updateBudget(user: AuthUser, budgetId: string, dto: UpdateBudgetDto) {
    if (Object.values(dto).every((v) => v === undefined)) {
      throw new BadRequestException('Nothing to change');
    }
    const itinerary = await this.findOwnedBy(user, 'days.budgets._id', budgetId, 'Budget entry');
    const entry = itinerary.days
      .map((d) => d.budgets.id(budgetId))
      .find((b) => b)!;
    if (dto.category !== undefined) entry.category = dto.category;
    if (dto.amount !== undefined) entry.amount = dto.amount;
    if (dto.currency !== undefined) entry.currency = await this.checkCurrency(dto.currency);
    if (dto.note !== undefined) entry.note = dto.note;
    await this.itineraries.save(itinerary);
    return this.itineraries.toDetail(itinerary);
  }

  async removeBudget(user: AuthUser, budgetId: string) {
    const itinerary = await this.findOwnedBy(user, 'days.budgets._id', budgetId, 'Budget entry');
    for (const day of itinerary.days) day.budgets.pull(budgetId);
    await this.itineraries.save(itinerary);
    return this.itineraries.toDetail(itinerary);
  }

  // =====================================================================================
  // Intercity transport costs (ITN-16)
  // =====================================================================================

  async addTransport(user: AuthUser, id: string, dto: CreateTransportCostDto) {
    const itinerary = await this.itineraries.getOwned(user, id);
    const day = this.itineraries.findDay(itinerary, dto.dayId);
    await this.itineraries.checkCity(dto.fromCity);
    await this.itineraries.checkCity(dto.toCity);
    itinerary.transportCosts.push({
      mode: dto.mode,
      fromCity: dto.fromCity,
      toCity: dto.toCity,
      amount: dto.amount,
      currency: await this.checkCurrency(dto.currency),
      day: day._id,
      note: dto.note ?? '',
    });
    await this.itineraries.save(itinerary);
    return this.itineraries.toDetail(itinerary);
  }

  async updateTransport(user: AuthUser, transportId: string, dto: UpdateTransportCostDto) {
    if (Object.values(dto).every((v) => v === undefined)) {
      throw new BadRequestException('Nothing to change');
    }
    const itinerary = await this.findOwnedBy(user, 'transportCosts._id', transportId, 'Transport cost');
    const entry = itinerary.transportCosts.id(transportId)!;
    if (dto.mode !== undefined) entry.mode = dto.mode;
    if (dto.fromCity !== undefined) {
      await this.itineraries.checkCity(dto.fromCity);
      entry.fromCity = dto.fromCity;
    }
    if (dto.toCity !== undefined) {
      await this.itineraries.checkCity(dto.toCity);
      entry.toCity = dto.toCity;
    }
    if (dto.amount !== undefined) entry.amount = dto.amount;
    if (dto.currency !== undefined) entry.currency = await this.checkCurrency(dto.currency);
    if (dto.dayId !== undefined) {
      entry.day = this.itineraries.findDay(itinerary, dto.dayId)._id;
    }
    if (dto.note !== undefined) entry.note = dto.note;
    await this.itineraries.save(itinerary);
    return this.itineraries.toDetail(itinerary);
  }

  async removeTransport(user: AuthUser, transportId: string) {
    const itinerary = await this.findOwnedBy(user, 'transportCosts._id', transportId, 'Transport cost');
    itinerary.transportCosts.pull(transportId);
    await this.itineraries.save(itinerary);
    return this.itineraries.toDetail(itinerary);
  }

  // =====================================================================================
  // Budget summary (ITN-14, ITN-18)
  // =====================================================================================

  /**
   * GET /api/itineraries/:id/budget-summary: totals by category, by day, by city group and
   * overall, all converted to one currency (?currency=, default: the user's preferred
   * currency) with the cached exchange rates, plus the date of those rates.
   * Only itinerary budgets are converted; booking prices are not (PAY-04).
   */
  async budgetSummary(user: AuthUser, id: string, currency?: string) {
    const itinerary = await this.itineraries.getOwned(user, id);
    const target = currency
      ? await this.exchangeRates.assertSupported(currency)
      : await this.itineraries.preferredCurrency(user.id);
    return this.summarize(itinerary, target);
  }

  async summarize(itinerary: ItineraryDocument, target: string) {
    const lines = budgetLines(itinerary);
    const needsRates = lines.some((l) => l.currency !== target);
    // 503 with a clear message when no rates were ever cached and the API is down
    const rates = needsRates ? await this.exchangeRates.getRates() : null;
    const converted = lines.map((l) => ({
      ...l,
      converted: rates
        ? this.exchangeRates.convert(l.amount, l.currency, target, rates)
        : l.amount,
    }));
    const sum = (filter: (l: BudgetLine) => boolean) =>
      sumAmounts(converted.filter(filter).map((l) => l.converted));
    const names = await this.itineraries.cityNames();
    return {
      itineraryId: itinerary._id.toString(),
      currency: target,
      rateDate: rates?.date ?? null,
      ratesFetchedAt: rates?.fetchedAt ?? null,
      byCategory: Object.fromEntries(
        SUMMARY_CATEGORIES.map((c) => [c, sum((l) => l.category === c)]),
      ),
      byDay: itinerary.days.map((day, i) => ({
        dayId: day._id.toString(),
        dayNumber: i + 1,
        date: dayDate(itinerary.startDate, i),
        city: day.city,
        total: sum((l) => l.dayIndex === i),
      })),
      byGroup: this.itineraries.cityGroups(itinerary, names).map((g) => ({
        ...g,
        subtotal: sum(
          (l) => l.dayIndex >= g.firstDay - 1 && l.dayIndex <= g.lastDay - 1,
        ),
      })),
      total: sum(() => true),
      /** The amounts as entered, before conversion */
      originalAmounts: perCurrency(lines),
    };
  }

  // =====================================================================================
  // Helpers
  // =====================================================================================

  /** ACC-09: the user's preferred currency, USD by default */
  preferredCurrency(user: AuthUser | undefined): Promise<string> {
    return this.itineraries.preferredCurrency(user?.id);
  }

  async checkCurrency(code: string): Promise<string> {
    const upper = code.toUpperCase();
    if (!(await this.reference.isSupportedCurrency(upper))) {
      throw new BadRequestException(
        `Unsupported currency ${upper}. See GET /api/currencies`,
      );
    }
    return upper;
  }

  /** Finds the itinerary that contains this sub-item and checks the user may change it */
  private async findOwnedBy(
    user: AuthUser,
    path: string,
    itemId: string,
    label: string,
  ): Promise<ItineraryDocument> {
    if (!Types.ObjectId.isValid(itemId)) throw new NotFoundException(`${label} not found`);
    const itinerary = await this.itineraryModel
      .findOne({ [path]: new Types.ObjectId(itemId) })
      .exec();
    if (!itinerary) throw new NotFoundException(`${label} not found`);
    return this.itineraries.getOwned(user, itinerary._id.toString(), label);
  }

  private async findActivity(user: AuthUser, activityId: string) {
    const itinerary = await this.findOwnedBy(user, 'days.activities._id', activityId, 'Activity');
    for (const day of itinerary.days) {
      const activity = day.activities.id(activityId);
      if (activity) return { itinerary, day, activity };
    }
    throw new NotFoundException('Activity not found');
  }

  private imageViews(images: { _id: Types.ObjectId; url: string }[]) {
    return images.map((img) => ({ id: img._id.toString(), url: img.url }));
  }
}

/** [{ currency: 'EGP', amount: 450 }, { currency: 'USD', amount: 20 }] */
function perCurrency(lines: BudgetLine[]) {
  const totals = new Map<string, number>();
  for (const l of lines) totals.set(l.currency, (totals.get(l.currency) ?? 0) + l.amount);
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amount]) => ({ currency, amount: round2(amount) }));
}
