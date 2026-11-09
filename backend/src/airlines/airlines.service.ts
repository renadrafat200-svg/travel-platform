import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter, Types } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import { paginate } from '../common/dto/pagination-query.dto';
import { ProviderType, Role } from '../common/enums/role.enum';
import { AuthUser } from '../common/interfaces/auth-user.interface';
import { assertManagesProvider } from '../common/utils/ownership';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import {
  AirlineQueryDto,
  BaggagePolicyDto,
  CancellationPolicyDto,
  CreateAirlineDto,
  UpdateAirlineDto,
} from './dto/airline.dto';
import { Airline, AirlineDocument, CancellationPolicy } from './schemas/airline.schema';

/** Used when the admin creates an airline without giving policies */
const DEFAULT_BAGGAGE = {
  cabin: { pieces: 1, maxWeightKg: 7 },
  checked: { pieces: 1, maxWeightKg: 23 },
  extraBagFee: 50,
  currency: 'USD',
};
const DEFAULT_CANCELLATION = {
  rules: [
    { hoursBeforeDeparture: 72, refundPercent: 100 },
    { hoursBeforeDeparture: 24, refundPercent: 50 },
    { hoursBeforeDeparture: 0, refundPercent: 0 },
  ],
};

@Injectable()
export class AirlinesService {
  constructor(
    @InjectModel(Airline.name) private readonly airlineModel: Model<Airline>,
    private readonly reference: ReferenceDataService,
    private readonly audit: AuditService,
  ) {}

  /** Admin creates an airline. Moderators are then assigned to it with POST /api/admin/moderators. */
  async create(admin: AuthUser, dto: CreateAirlineDto) {
    await this.assertCountry(dto.country);
    if (await this.airlineModel.exists({ iataCode: dto.iataCode })) {
      throw new BadRequestException(`An airline with IATA code ${dto.iataCode} already exists`);
    }
    const baggagePolicy = dto.baggagePolicy ?? DEFAULT_BAGGAGE;
    await this.assertCurrency(baggagePolicy.currency);
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
    if (!(query.includeInactive && user?.role === Role.ADMIN)) filter.isActive = true;
    if (query.country) filter.country = query.country;
    if (query.search) {
      const re = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: re }, { iataCode: re }];
    }
    const sortable = ['name', 'iataCode', 'country', 'createdAt'];
    const sortField = query.sortBy && sortable.includes(query.sortBy) ? query.sortBy : 'name';
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
    await this.assertCurrency(dto.currency);

    airline.baggagePolicy = dto;
    await airline.save();
    await this.audit.log(user, {
      action: 'airline.baggage_policy.update',
      targetType: 'airline',
      targetId: airline._id,
    });
    return this.toView(airline).baggagePolicy;
  }

  async updateCancellationPolicy(user: AuthUser, id: string, dto: CancellationPolicyDto) {
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

  // ---------- helpers for teammates ----------

  /** Member 1: check the airline exists before assigning a moderator to it */
  async exists(id: string): Promise<boolean> {
    return Types.ObjectId.isValid(id) && !!(await this.airlineModel.exists({ _id: id }));
  }

  /** Flights / flight search: is this airline allowed to sell tickets right now? */
  async isActive(id: string | Types.ObjectId): Promise<boolean> {
    return !!(await this.airlineModel.exists({ _id: id, isActive: true }));
  }

  /** Flight search: ids of all active airlines, to hide flights of deactivated ones */
  async activeIds(): Promise<Types.ObjectId[]> {
    const docs = await this.airlineModel.find({ isActive: true }, { _id: 1 }).lean().exec();
    return docs.map((d) => d._id);
  }

  /**
   * Member 6 (refunds): percentage refunded when cancelling `hoursBeforeDeparture` hours before the flight.
   * Picks the first rule whose threshold has not passed; 0 if none applies.
   */
  async refundPercent(
    airlineId: string | Types.ObjectId,
    hoursBeforeDeparture: number,
  ): Promise<number> {
    const airline = await this.airlineModel
      .findById(airlineId, { cancellationPolicy: 1 })
      .lean()
      .exec();
    if (!airline) throw new NotFoundException('Airline not found');
    const rule = airline.cancellationPolicy.rules.find(
      (r) => hoursBeforeDeparture >= r.hoursBeforeDeparture,
    );
    return rule?.refundPercent ?? 0;
  }

  // ---------- private ----------

  private async getById(id: string): Promise<AirlineDocument> {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid airline id');
    const airline = await this.airlineModel.findById(id).exec();
    if (!airline) throw new NotFoundException('Airline not found');
    return airline;
  }

  private canManage(user: AuthUser | undefined, airlineId: Types.ObjectId): boolean {
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
      throw new BadRequestException(`Unknown country code ${code}. See GET /api/countries`);
    }
  }

  private async assertCurrency(code: string) {
    if (!(await this.reference.isSupportedCurrency(code))) {
      throw new BadRequestException(`Unsupported currency ${code}. See GET /api/currencies`);
    }
  }

  /** Sorts rules from most to fewest hours and rejects duplicates or refunds that go up closer to departure */
  private normaliseCancellation(policy: CancellationPolicy): CancellationPolicy {
    const rules = [...policy.rules].sort((a, b) => b.hoursBeforeDeparture - a.hoursBeforeDeparture);
    for (let i = 1; i < rules.length; i++) {
      if (rules[i].hoursBeforeDeparture === rules[i - 1].hoursBeforeDeparture) {
        throw new BadRequestException('Two cancellation rules have the same hoursBeforeDeparture');
      }
      if (rules[i].refundPercent > rules[i - 1].refundPercent) {
        throw new BadRequestException('Refunds cannot increase closer to departure');
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
        cabin: {
          pieces: a.baggagePolicy.cabin.pieces,
          maxWeightKg: a.baggagePolicy.cabin.maxWeightKg,
        },
        checked: {
          pieces: a.baggagePolicy.checked.pieces,
          maxWeightKg: a.baggagePolicy.checked.maxWeightKg,
        },
        extraBagFee: a.baggagePolicy.extraBagFee,
        currency: a.baggagePolicy.currency,
        notes: a.baggagePolicy.notes,
      },
      cancellationPolicy: {
        rules: a.cancellationPolicy.rules.map((r) => ({
          hoursBeforeDeparture: r.hoursBeforeDeparture,
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
