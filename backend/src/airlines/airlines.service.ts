import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter, Types } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import { paginate } from '../common/dto/pagination-query.dto';
import { ProviderType, Role } from '../common/enums/role.enum';
import { AuthUser } from '../common/interfaces/auth-user.interface';
import { assertManagesProvider } from '../common/utils/ownership';
import { PLATFORM_CURRENCY } from '../config/platform.constants';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { type UploadedImage, validateImages } from '../common/utils/image-upload';
import { randomUUID } from 'crypto';
import {
  AirlineQueryDto,
  BaggagePolicyDto,
  CancellationPolicyDto,
  CreateAirlineDto,
  UpdateAirlineDto,
} from './dto/airline.dto';
import {
  Airline,
  AirlineDocument,
  CancellationPolicy,
} from './schemas/airline.schema';
import { AirlineLogoFile } from './schemas/airline-logo-file.schema';

/** Used when the admin creates an airline without giving policies */
const DEFAULT_BAGGAGE = { extraBagPrice: 50, maxExtraBags: 3 };
const DEFAULT_CANCELLATION = {
  rules: [
    { daysBeforeDeparture: 7, refundPercent: 100 },
    { daysBeforeDeparture: 2, refundPercent: 50 },
    { daysBeforeDeparture: 0, refundPercent: 0 },
  ],
};

@Injectable()
export class AirlinesService implements OnModuleInit {
  private readonly logger = new Logger(AirlinesService.name);

  constructor(
    @InjectModel(Airline.name) private readonly airlineModel: Model<Airline>,
    @InjectModel(AirlineLogoFile.name) private readonly logoModel: Model<AirlineLogoFile>,
    private readonly reference: ReferenceDataService,
    private readonly audit: AuditService,
  ) {}

  /** Admin creates an airline. Moderators are then assigned to it with POST /api/admin/moderators. */
  async create(admin: AuthUser, dto: CreateAirlineDto) {
    await this.assertCountry(dto.country);
    if (await this.airlineModel.exists({ iataCode: dto.iataCode })) {
      throw new BadRequestException(
        `An airline with IATA code ${dto.iataCode} already exists`,
      );
    }
    const baggagePolicy = dto.baggagePolicy ?? DEFAULT_BAGGAGE;
    const cancellationPolicy = this.normaliseCancellation(
      dto.cancellationPolicy ?? DEFAULT_CANCELLATION,
    );

    const airline = await this.airlineModel.create({
      ...dto,
      baggagePolicy,
      cancellationPolicy,
    });
    await this.audit.log(admin, {
      action: 'airline.create',
      targetType: 'airline',
      targetId: airline._id,
      details: { name: airline.name, iataCode: airline.iataCode },
    });
    return this.toView(airline);
  }

  /** Public list. Guests only see active airlines; admins can ask for deactivated ones too. */
  async findAll(query: AirlineQueryDto, user?: AuthUser) {
    const filter: QueryFilter<Airline> = {};
    if (!(query.includeInactive && user?.role === Role.ADMIN))
      filter.isActive = true;
    if (query.country) filter.country = query.country;
    if (query.search) {
      const re = new RegExp(
        query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'i',
      );
      filter.$or = [{ name: re }, { iataCode: re }];
    }
    const sortable = ['name', 'iataCode', 'country', 'createdAt'];
    const sortField =
      query.sortBy && sortable.includes(query.sortBy) ? query.sortBy : 'name';
    const sortDir = query.order === 'desc' ? -1 : 1;

    const [docs, total] = await Promise.all([
      this.airlineModel
        .find(filter)
        .sort({ [sortField]: sortDir })
        .skip(query.skip)
        .limit(query.limit)
        .exec(),
      this.airlineModel.countDocuments(filter).exec(),
    ]);
    return paginate(
      docs.map((d) => this.toView(d)),
      total,
      query,
    );
  }

  /** One airline. A deactivated one is hidden (404) from everyone except admins and its own moderator. */
  async findOne(id: string, user?: AuthUser) {
    const airline = await this.getById(id);
    if (!airline.isActive && !this.canManage(user, airline._id)) {
      throw new NotFoundException('Airline not found');
    }
    return this.toView(airline);
  }

  /** The airline the logged-in airline moderator manages */
  async findMine(user: AuthUser) {
    if (!user.providerId || user.providerType !== ProviderType.AIRLINE) {
      throw new NotFoundException('No airline is assigned to your account');
    }
    return this.toView(await this.getById(user.providerId));
  }

  /** Baggage and cancellation rules, shown to travellers before they book */
  async getPolicies(id: string, user?: AuthUser) {
    const airline = await this.findOne(id, user);
    return {
      airlineId: airline.id,
      name: airline.name,
      baggagePolicy: airline.baggagePolicy,
      cancellationPolicy: airline.cancellationPolicy,
    };
  }

  /** Admin or this airline's moderator edits the profile */
  async update(user: AuthUser, id: string, dto: UpdateAirlineDto) {
    const airline = await this.getById(id);
    assertManagesProvider(user, ProviderType.AIRLINE, airline._id);
    if (dto.country) await this.assertCountry(dto.country);

    airline.set(dto);
    await airline.save();
    await this.audit.log(user, {
      action: 'airline.update',
      targetType: 'airline',
      targetId: airline._id,
      details: { fields: Object.keys(dto) },
    });
    return this.toView(airline);
  }

  async updateBaggagePolicy(user: AuthUser, id: string, dto: BaggagePolicyDto) {
    const airline = await this.getById(id);
    assertManagesProvider(user, ProviderType.AIRLINE, airline._id);

    airline.baggagePolicy = dto;
    await airline.save();
    await this.audit.log(user, {
      action: 'airline.baggage_policy.update',
      targetType: 'airline',
      targetId: airline._id,
    });
    return this.toView(airline).baggagePolicy;
  }

  async updateCancellationPolicy(
    user: AuthUser,
    id: string,
    dto: CancellationPolicyDto,
  ) {
    const airline = await this.getById(id);
    assertManagesProvider(user, ProviderType.AIRLINE, airline._id);

    airline.cancellationPolicy = this.normaliseCancellation(dto);
    await airline.save();
    await this.audit.log(user, {
      action: 'airline.cancellation_policy.update',
      targetType: 'airline',
      targetId: airline._id,
    });
    return this.toView(airline).cancellationPolicy;
  }

  /**
   * FLT-01 / GEN-08: upload the airline logo (JPG or PNG, max 5 MB, ONE per airline).
   * A new upload replaces the old logo. Admin or this airline's moderator.
   */
  async uploadLogo(user: AuthUser, id: string, file: UploadedImage | undefined) {
    const airline = await this.getById(id);
    assertManagesProvider(user, ProviderType.AIRLINE, airline._id);
    const [{ type, extension }] = validateImages(file ? [file] : [], 0, 1, 'logo');

    const fileName = `${airline._id.toString()}-${randomUUID()}.${extension}`;
    await this.logoModel.create({
      fileName,
      airline: airline._id,
      contentType: type,
      size: file!.size,
      data: file!.buffer,
    });
    const oldFile = this.logoFileName(airline.logoUrl);
    airline.logoUrl = `/api/airlines/logos/${fileName}`;
    await airline.save();
    if (oldFile) await this.logoModel.deleteOne({ fileName: oldFile }).exec();

    await this.audit.log(user, {
      action: 'airline.logo.upload',
      targetType: 'airline',
      targetId: airline._id,
    });
    return { logoUrl: airline.logoUrl };
  }

  /** Removes the airline's logo */
  async removeLogo(user: AuthUser, id: string) {
    const airline = await this.getById(id);
    assertManagesProvider(user, ProviderType.AIRLINE, airline._id);
    const oldFile = this.logoFileName(airline.logoUrl);
    if (!oldFile) throw new NotFoundException('This airline has no logo');
    airline.logoUrl = undefined;
    await airline.save();
    await this.logoModel.deleteOne({ fileName: oldFile }).exec();
    return { logoUrl: null };
  }

  /** GET /api/airlines/logos/:fileName: the image bytes */
  async logoFile(fileName: string) {
    if (!/^[a-f0-9]{24}-[a-f0-9-]{36}\.(jpg|png)$/.test(fileName)) {
      throw new NotFoundException('Logo not found');
    }
    const file = await this.logoModel.findOne({ fileName }).exec();
    if (!file) throw new NotFoundException('Logo not found');
    return { data: file.data, contentType: file.contentType };
  }

  private logoFileName(logoUrl?: string) {
    return logoUrl?.startsWith('/api/airlines/logos/')
      ? logoUrl.slice('/api/airlines/logos/'.length)
      : undefined;
  }

  // ---------- helpers for teammates ----------

  /** Member 1: check the airline exists before assigning a moderator to it */
  async exists(id: string): Promise<boolean> {
    return (
      Types.ObjectId.isValid(id) &&
      !!(await this.airlineModel.exists({ _id: id }))
    );
  }

  /** Flights: basic info about one airline (null if it does not exist) */
  async getBasic(id: string | Types.ObjectId) {
    if (!Types.ObjectId.isValid(id.toString())) return null;
    const a = await this.airlineModel
      .findById(id, { name: 1, iataCode: 1, isActive: 1 })
      .lean()
      .exec();
    return a
      ? {
          id: a._id.toString(),
          name: a.name,
          iataCode: a.iataCode,
          isActive: a.isActive,
        }
      : null;
  }

  /**
   * Member 3 (FLT-19): extra-bag price and the most extra bags one passenger may add.
   * 404 if the airline does not exist.
   */
  async baggageRules(id: string | Types.ObjectId) {
    const a = await this.airlineModel
      .findById(id, { baggagePolicy: 1 })
      .lean()
      .exec();
    if (!a) throw new NotFoundException('Airline not found');
    return {
      extraBagPrice: a.baggagePolicy.extraBagPrice,
      maxExtraBags: a.baggagePolicy.maxExtraBags,
    };
  }

  /** Flight search: name and code of several airlines at once, keyed by id */
  async summaries(ids: (string | Types.ObjectId)[]) {
    const docs = await this.airlineModel
      .find({ _id: { $in: ids } }, { name: 1, iataCode: 1 })
      .lean()
      .exec();
    return new Map(
      docs.map((d) => [
        d._id.toString(),
        { id: d._id.toString(), name: d.name, iataCode: d.iataCode },
      ]),
    );
  }

  /** Flights / flight search: is this airline allowed to sell tickets right now? */
  async isActive(id: string | Types.ObjectId): Promise<boolean> {
    return !!(await this.airlineModel.exists({ _id: id, isActive: true }));
  }

  /**
   * Member 1 (ACC-15): deactivate or reactivate an airline. Deactivated airlines vanish from
   * lists and flight search and cannot be booked; existing bookings stay valid.
   * (The admin module checks the current state and writes the audit log.)
   */
  async setActive(id: string, active: boolean) {
    const airline = await this.getById(id);
    airline.isActive = active;
    airline.deactivatedAt = active ? undefined : new Date();
    await airline.save();
    return this.toView(airline);
  }

  /** Flight search: ids of all active airlines, to hide flights of deactivated ones */
  async activeIds(): Promise<Types.ObjectId[]> {
    const docs = await this.airlineModel
      .find({ isActive: true }, { _id: 1 })
      .lean()
      .exec();
    return docs.map((d) => d._id);
  }

  /**
   * FLT-09 / FLT-26 / Member 6: refund percentage when cancelling `hoursBeforeDeparture` hours
   * before the flight. Converted to WHOLE days remaining (e.g. 47 hours = 1 day), then the tier with
   * the highest threshold not exceeding the days remaining is used; 0% if no tier applies.
   */
  async refundPercent(
    airlineId: string | Types.ObjectId,
    hoursBeforeDeparture: number,
  ): Promise<number> {
    return this.refundPercentForDays(
      airlineId,
      Math.floor(hoursBeforeDeparture / 24),
    );
  }

  /** FLT-09: same as refundPercent, with the whole days remaining already worked out */
  async refundPercentForDays(
    airlineId: string | Types.ObjectId,
    daysBeforeDeparture: number,
  ): Promise<number> {
    const airline = await this.airlineModel
      .findById(airlineId, { cancellationPolicy: 1 })
      .lean()
      .exec();
    if (!airline) throw new NotFoundException('Airline not found');
    const applicable = airline.cancellationPolicy.rules.filter(
      (r) => r.daysBeforeDeparture <= daysBeforeDeparture,
    );
    if (applicable.length === 0) return 0;
    return applicable.reduce((best, r) =>
      r.daysBeforeDeparture > best.daysBeforeDeparture ? r : best,
    ).refundPercent;
  }

  /**
   * One-time upgrade of airlines saved before the workbook fixes (hours-based tiers,
   * one baggage rule for all cabins, any currency). Runs at startup; does nothing once converted.
   */
  async onModuleInit() {
    const old = await this.airlineModel.collection
      .find({
        $or: [
          { 'baggagePolicy.extraBagPrice': { $exists: false } },
          {
            'cancellationPolicy.rules.hoursBeforeDeparture': { $exists: true },
          },
        ],
      })
      .toArray();
    for (const a of old) {
      const bp = (a.baggagePolicy ?? {}) as Record<string, unknown>;
      const oldRules = ((
        a.cancellationPolicy as { rules?: Record<string, number>[] }
      )?.rules ?? []) as Record<string, number>[];
      // hours -> whole days; keep the highest refund when two tiers land on the same day
      const byDay = new Map<number, number>();
      for (const r of oldRules) {
        const day =
          r.daysBeforeDeparture ??
          Math.floor((r.hoursBeforeDeparture ?? 0) / 24);
        byDay.set(day, Math.max(byDay.get(day) ?? 0, r.refundPercent ?? 0));
      }
      const rules = [...byDay.entries()]
        .sort((x, y) => y[0] - x[0])
        .map(([daysBeforeDeparture, refundPercent]) => ({
          daysBeforeDeparture,
          refundPercent,
        }));
      await this.airlineModel.collection.updateOne(
        { _id: a._id },
        {
          $set: {
            'baggagePolicy.extraBagPrice':
              (bp.extraBagPrice as number) || (bp.extraBagFee as number) || 50,
            'baggagePolicy.maxExtraBags': (bp.maxExtraBags as number) ?? 3,
            'cancellationPolicy.rules': rules,
          },
          $unset: {
            'baggagePolicy.cabin': '',
            'baggagePolicy.checked': '',
            'baggagePolicy.extraBagFee': '',
            'baggagePolicy.currency': '',
          },
        },
      );
    }
    if (old.length)
      this.logger.log(
        `Upgraded ${old.length} airline(s) to the new policy format`,
      );
  }

  // ---------- private ----------

  private async getById(id: string): Promise<AirlineDocument> {
    if (!Types.ObjectId.isValid(id))
      throw new BadRequestException('Invalid airline id');
    const airline = await this.airlineModel.findById(id).exec();
    if (!airline) throw new NotFoundException('Airline not found');
    return airline;
  }

  private canManage(
    user: AuthUser | undefined,
    airlineId: Types.ObjectId,
  ): boolean {
    if (!user) return false;
    if (user.role === Role.ADMIN) return true;
    return (
      user.role === Role.AIRLINE_MODERATOR &&
      user.providerType === ProviderType.AIRLINE &&
      user.providerId === airlineId.toString()
    );
  }

  private async assertCountry(code: string) {
    if (!(await this.reference.findCountry(code))) {
      throw new BadRequestException(
        `Unknown country code ${code}. See GET /api/countries`,
      );
    }
  }

  /** FLT-09: sorts tiers from most to fewest days and rejects duplicate thresholds or refunds that go up closer to departure */
  private normaliseCancellation(
    policy: CancellationPolicy,
  ): CancellationPolicy {
    const rules = [...policy.rules]
      .map((r) => ({
        daysBeforeDeparture: r.daysBeforeDeparture,
        refundPercent: r.refundPercent,
      }))
      .sort((a, b) => b.daysBeforeDeparture - a.daysBeforeDeparture);
    for (let i = 1; i < rules.length; i++) {
      if (rules[i].daysBeforeDeparture === rules[i - 1].daysBeforeDeparture) {
        throw new BadRequestException(
          `Two cancellation tiers have the same threshold (${rules[i].daysBeforeDeparture} days). Each threshold must be unique.`,
        );
      }
      if (rules[i].refundPercent > rules[i - 1].refundPercent) {
        throw new BadRequestException(
          'Refunds cannot increase closer to departure',
        );
      }
    }
    return { rules, notes: policy.notes };
  }

  private toView(a: AirlineDocument) {
    return {
      id: a._id.toString(),
      name: a.name,
      iataCode: a.iataCode,
      country: a.country,
      description: a.description,
      logoUrl: a.logoUrl,
      contactEmail: a.contactEmail,
      contactPhone: a.contactPhone,
      website: a.website,
      baggagePolicy: {
        extraBagPrice: a.baggagePolicy.extraBagPrice,
        maxExtraBags: a.baggagePolicy.maxExtraBags,
        currency: PLATFORM_CURRENCY,
        notes: a.baggagePolicy.notes,
        freeAllowance: 'Set per cabin on each flight (see the flight details)',
      },
      cancellationPolicy: {
        rules: a.cancellationPolicy.rules.map((r) => ({
          daysBeforeDeparture: r.daysBeforeDeparture,
          refundPercent: r.refundPercent,
        })),
        notes: a.cancellationPolicy.notes,
      },
      isActive: a.isActive,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    };
  }
}
