import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter, Types } from 'mongoose';
import { AirlinesService } from '../airlines/airlines.service';
import { AuditService } from '../audit/audit.service';
import { paginate } from '../common/dto/pagination-query.dto';
import { ProviderType, Role } from '../common/enums/role.enum';
import { AuthUser } from '../common/interfaces/auth-user.interface';
import { assertManagesProvider } from '../common/utils/ownership';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { PLATFORM_CURRENCY } from '../config/platform.constants';
import {
  CancelFlightDto,
  CreateCabinDto,
  CreateFlightDto,
  MyFlightsQueryDto,
  UpdateCabinDto,
  UpdateFlightDto,
} from './dto/flight.dto';
import {
  CabinPrices,
  Flight,
  FlightDocument,
  FlightStatus,
} from './schemas/flight.schema';
import { localToUtc, utcOffsetLabel, utcToLocal } from './time-zone.util';

/** FLT-12: adults and children pay the cabin fare, infants pay 10% of it */
const INFANT_SHARE = 0.1;
/** Longest allowed flight; anything longer is almost certainly a typo in the times */
const MAX_DURATION_MINUTES = 24 * 60;

type AirportInfo = {
  iataCode: string;
  name: string;
  cityId: string;
  timeZone: string;
};
type AirlineInfo = { id: string; name: string; iataCode: string };

type FlightCancelledListener = (
  flightId: Types.ObjectId,
  reason?: string,
) => Promise<unknown>;

@Injectable()
export class FlightsService implements OnModuleInit {
  /** Other modules (flight bookings) register here to react when a flight is cancelled */
  private readonly cancelledListeners: FlightCancelledListener[] = [];
  private readonly logger = new Logger(FlightsService.name);
  constructor(
    @InjectModel(Flight.name) private readonly flightModel: Model<Flight>,
    private readonly airlines: AirlinesService,
    private readonly reference: ReferenceDataService,
    private readonly audit: AuditService,
  ) {}

  /** FLT-03: an airline moderator (or an admin) creates a flight */
  async create(user: AuthUser, dto: CreateFlightDto) {
    const airlineId = this.resolveAirlineId(user, dto.airlineId);
    const airline = await this.airlines.getBasic(airlineId);
    if (!airline) throw new NotFoundException('Airline not found');
    if (!airline.isActive)
      throw new BadRequestException('This airline is deactivated');
    assertManagesProvider(user, ProviderType.AIRLINE, airline.id);

    if (dto.origin === dto.destination) {
      throw new BadRequestException(
        'Origin and destination must be different airports',
      );
    }
    const [origin, destination] = await Promise.all([
      this.getAirport(dto.origin),
      this.getAirport(dto.destination),
    ]);
    const times = this.toUtcTimes(
      dto.departureLocal,
      dto.arrivalLocal,
      origin,
      destination,
    );
    await this.assertNoDuplicate(
      airline.id,
      dto.flightNumber,
      dto.departureLocal,
      origin,
    );

    const cabins = dto.cabins ?? [];
    const classes = cabins.map((c) => c.cabinClass);
    if (new Set(classes).size !== classes.length) {
      throw new BadRequestException(
        'Each cabin class can only appear once per flight',
      );
    }

    const flight = await this.flightModel.create({
      airline: new Types.ObjectId(airline.id),
      flightNumber: dto.flightNumber,
      origin: origin.iataCode,
      destination: destination.iataCode,
      ...times,
      currency: PLATFORM_CURRENCY,
      cabins: cabins.map((c) => this.newCabin(c)),
    });
    await this.audit.log(user, {
      action: 'flight.create',
      targetType: 'flight',
      targetId: flight._id,
      details: {
        flightNumber: flight.flightNumber,
        route: `${flight.origin}-${flight.destination}`,
      },
    });
    return this.toView(flight, airline, {
      [origin.iataCode]: origin,
      [destination.iataCode]: destination,
    });
  }

  /** FLT-17: flight details. Flights of a deactivated airline are hidden from the public. */
  async findOne(id: string, user?: AuthUser) {
    await this.markDepartedFlights();
    const flight = await this.getById(id);
    const airline = await this.airlines.getBasic(flight.airline);
    if (
      !airline ||
      (!airline.isActive && !this.canManage(user, flight.airline))
    ) {
      throw new NotFoundException('Flight not found');
    }
    // FLT-17: the details page also shows the airline's baggage and cancellation policies
    const policies = await this.airlines.getPolicies(airline.id, user);
    return {
      ...(await this.fullView(flight, airline)),
      baggagePolicy: policies.baggagePolicy,
      cancellationPolicy: policies.cancellationPolicy,
    };
  }

  /**
   * Scheduled flights whose departure time has passed become Departed.
   * Runs every minute, and also right before flights are read so the status is never stale.
   * The status condition makes it safe if two runs overlap.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async markDepartedFlights() {
    const now = new Date();
    const res = await this.flightModel
      .updateMany(
        { status: FlightStatus.SCHEDULED, departureTime: { $lte: now } },
        { $set: { status: FlightStatus.DEPARTED, departedAt: now } },
      )
      .exec();
    if (res.modifiedCount > 0)
      this.logger.log(`${res.modifiedCount} flight(s) marked Departed`);
    return res.modifiedCount;
  }

  /** The logged-in moderator's flights (admins can pass airlineId) */
  async findMine(user: AuthUser, query: MyFlightsQueryDto) {
    await this.markDepartedFlights();
    const airlineId = this.resolveAirlineId(user, query.airlineId);
    const filter: QueryFilter<Flight> = {
      airline: new Types.ObjectId(airlineId),
    };
    if (query.status) filter.status = query.status;
    if (query.flightNumber) filter.flightNumber = query.flightNumber;

    const [docs, total, airline] = await Promise.all([
      this.flightModel
        .find(filter)
        .sort({ departureTime: query.order === 'desc' ? -1 : 1 })
        .skip(query.skip)
        .limit(query.limit)
        .exec(),
      this.flightModel.countDocuments(filter).exec(),
      this.airlines.getBasic(airlineId),
    ]);
    if (!airline) throw new NotFoundException('Airline not found');
    const airports = await this.airportMap(
      docs.flatMap((d) => [d.origin, d.destination]),
    );
    return paginate(
      docs.map((d) => this.toView(d, airline, airports)),
      total,
      query,
    );
  }

  /** FLT-05: schedule change (new times and/or flight number) */
  async update(user: AuthUser, id: string, dto: UpdateFlightDto) {
    const flight = await this.getManageable(user, id);
    this.assertChangeable(flight);

    const [origin, destination] = await Promise.all([
      this.getAirport(flight.origin),
      this.getAirport(flight.destination),
    ]);
    const before = {
      departure: utcToLocal(flight.departureTime, origin.timeZone),
      arrival: utcToLocal(flight.arrivalTime, destination.timeZone),
    };
    if (dto.departureLocal || dto.flightNumber) {
      await this.assertNoDuplicate(
        flight.airline.toString(),
        dto.flightNumber ?? flight.flightNumber,
        dto.departureLocal ?? before.departure,
        origin,
        flight._id,
      );
    }
    if (dto.departureLocal || dto.arrivalLocal) {
      const times = this.toUtcTimes(
        dto.departureLocal ?? before.departure,
        dto.arrivalLocal ?? before.arrival,
        origin,
        destination,
      );
      flight.set(times);
    }
    if (dto.flightNumber) flight.flightNumber = dto.flightNumber;
    await flight.save();

    await this.audit.log(user, {
      action: 'flight.update',
      targetType: 'flight',
      targetId: flight._id,
      details: { before, changes: dto },
    });
    // TODO (Member 6): notify passengers with bookings on this flight about the schedule change.
    return this.fullView(flight);
  }

  /** FLT-06: the airline cancels the flight */
  async cancel(user: AuthUser, id: string, dto: CancelFlightDto) {
    const flight = await this.getManageable(user, id);
    this.assertChangeable(flight);

    flight.status = FlightStatus.CANCELLED;
    flight.cancelledAt = new Date();
    flight.cancellationReason = dto.reason;
    await flight.save();

    await this.audit.log(user, {
      action: 'flight.cancel',
      targetType: 'flight',
      targetId: flight._id,
      details: { reason: dto.reason, flightNumber: flight.flightNumber },
    });
    // Member 3: cancels every booking on this flight and marks paid ones for a full refund
    for (const listener of this.cancelledListeners)
      await listener(flight._id, dto.reason);
    return this.fullView(flight);
  }

  /** FLT-04: add a cabin class with its seats and prices */
  async addCabin(user: AuthUser, id: string, dto: CreateCabinDto) {
    const flight = await this.getManageable(user, id);
    this.assertChangeable(flight);
    if (flight.cabins.some((c) => c.cabinClass === dto.cabinClass)) {
      throw new BadRequestException(
        `This flight already has a ${dto.cabinClass} cabin; edit it instead`,
      );
    }
    flight.cabins.push(this.newCabin(dto));
    await flight.save();
    await this.audit.log(user, {
      action: 'flight.cabin.create',
      targetType: 'flight',
      targetId: flight._id,
      details: { cabinClass: dto.cabinClass, totalSeats: dto.totalSeats },
    });
    return this.fullView(flight);
  }

  /** FLT-04, FLT-05: change a cabin's seat count or prices without losing seats already held or sold */
  async updateCabin(
    user: AuthUser,
    id: string,
    cabinId: string,
    dto: UpdateCabinDto,
  ) {
    const flight = await this.getManageable(user, id);
    this.assertChangeable(flight);
    const cabin = Types.ObjectId.isValid(cabinId)
      ? flight.cabins.id(cabinId)
      : null;
    if (!cabin) throw new NotFoundException('Cabin not found on this flight');

    if (dto.totalSeats !== undefined) {
      const taken = cabin.totalSeats - cabin.availableSeats;
      if (dto.totalSeats < taken) {
        throw new BadRequestException(
          `${taken} seats are already held or sold in this cabin, so totalSeats cannot be below ${taken}`,
        );
      }
      cabin.availableSeats = dto.totalSeats - taken;
      cabin.totalSeats = dto.totalSeats;
    }
    if (dto.price !== undefined) {
      // FLT-05: existing bookings keep the price they were booked at
      cabin.price = dto.price;
      cabin.prices = this.fullPrices(dto.price);
    }
    if (dto.freeBags !== undefined) cabin.freeBags = dto.freeBags;
    if (dto.maxBagWeightKg !== undefined)
      cabin.maxBagWeightKg = dto.maxBagWeightKg;
    await flight.save();

    await this.audit.log(user, {
      action: 'flight.cabin.update',
      targetType: 'flight',
      targetId: flight._id,
      details: { cabinId, changes: dto },
    });
    return this.fullView(flight);
  }

  /** FlightBookingsService calls this once at startup (avoids a circular module import) */
  onFlightCancelled(listener: FlightCancelledListener) {
    this.cancelledListeners.push(listener);
  }
  // ---------- shared helpers (also used by FlightSearchService) ----------

  async airportMap(codes: string[]): Promise<Record<string, AirportInfo>> {
    const unique = [...new Set(codes)];
    const found = await Promise.all(
      unique.map((c) => this.reference.findAirport(c)),
    );
    const map: Record<string, AirportInfo> = {};
    found.forEach((a) => {
      if (a) map[a.iataCode] = a;
    });
    return map;
  }

  /** Loads the airline and airports, then builds the response */
  async fullView(flight: FlightDocument, airline?: AirlineInfo | null) {
    const [a, airports] = await Promise.all([
      airline ?? this.airlines.getBasic(flight.airline),
      this.airportMap([flight.origin, flight.destination]),
    ]);
    return this.toView(flight, a, airports);
  }

  /** Builds the response shape: UTC times plus each airport's local time and offset */
  toView(
    f: FlightDocument | Flight,
    airline?: AirlineInfo | null,
    airports: Record<string, AirportInfo> = {},
  ) {
    const point = (code: string, at: Date) => {
      const ap = airports[code];
      return {
        airport: code,
        airportName: ap?.name,
        cityId: ap?.cityId,
        timeZone: ap?.timeZone,
        localTime: ap ? utcToLocal(at, ap.timeZone) : undefined,
        utcOffset: ap ? utcOffsetLabel(at, ap.timeZone) : undefined,
        utc: at.toISOString(),
      };
    };
    return {
      id: f._id.toString(),
      flightNumber: f.flightNumber,
      airline: airline
        ? { id: airline.id, name: airline.name, iataCode: airline.iataCode }
        : { id: f.airline.toString() },
      departure: point(f.origin, f.departureTime),
      arrival: point(f.destination, f.arrivalTime),
      durationMinutes: f.durationMinutes,
      currency: f.currency,
      status: f.status,
      cancellationReason: f.cancellationReason,
      departedAt: f.departedAt,
      cabins: f.cabins.map((c) => ({
        id: c._id.toString(),
        cabinClass: c.cabinClass,
        totalSeats: c.totalSeats,
        availableSeats: c.availableSeats,
        price: c.price,
        prices: {
          adult: c.prices.adult,
          child: c.prices.child,
          infant: c.prices.infant,
        },
        // FLT-04 / FLT-17: free baggage allowance per passenger
        baggageAllowance: {
          freeBags: c.freeBags,
          maxBagWeightKg: c.maxBagWeightKg,
        },
      })),
    };
  }

  // ---------- private ----------

  /** Moderators always act for their own airline; admins must say which airline */
  private resolveAirlineId(user: AuthUser, requested?: string): string {
    if (user.role === Role.ADMIN) {
      if (!requested)
        throw new BadRequestException('airlineId is required for admins');
      return requested;
    }
    if (user.providerType !== ProviderType.AIRLINE || !user.providerId) {
      throw new BadRequestException('No airline is assigned to your account');
    }
    return user.providerId;
  }

  private async getById(id: string): Promise<FlightDocument> {
    if (!Types.ObjectId.isValid(id))
      throw new BadRequestException('Invalid flight id');
    const flight = await this.flightModel.findById(id).exec();
    if (!flight) throw new NotFoundException('Flight not found');
    return flight;
  }

  private async getManageable(user: AuthUser, id: string) {
    const flight = await this.getById(id);
    assertManagesProvider(user, ProviderType.AIRLINE, flight.airline);
    return flight;
  }

  private canManage(user: AuthUser | undefined, airlineId: Types.ObjectId) {
    if (!user) return false;
    if (user.role === Role.ADMIN) return true;
    return (
      user.providerType === ProviderType.AIRLINE &&
      user.providerId === airlineId.toString()
    );
  }

  private assertChangeable(flight: FlightDocument) {
    if (flight.status === FlightStatus.CANCELLED) {
      throw new BadRequestException(
        'This flight is cancelled and can no longer be changed',
      );
    }
    // Only Scheduled flights can be edited or cancelled (FLT-05, FLT-06)
    if (
      flight.status === FlightStatus.DEPARTED ||
      flight.departureTime <= new Date()
    ) {
      throw new BadRequestException('This flight has already departed');
    }
  }

  private async getAirport(code: string): Promise<AirportInfo> {
    const airport = await this.reference.findAirport(code);
    if (!airport)
      throw new BadRequestException(
        `Unknown airport ${code}. See GET /api/airports`,
      );
    return airport;
  }

  /** Converts both local times to UTC and checks they make sense */
  private toUtcTimes(
    depLocal: string,
    arrLocal: string,
    origin: AirportInfo,
    destination: AirportInfo,
  ) {
    const departureTime = localToUtc(depLocal, origin.timeZone);
    if (!departureTime) {
      throw new BadRequestException(
        `${depLocal} is not a valid local time in ${origin.timeZone}`,
      );
    }
    const arrivalTime = localToUtc(arrLocal, destination.timeZone);
    if (!arrivalTime) {
      throw new BadRequestException(
        `${arrLocal} is not a valid local time in ${destination.timeZone}`,
      );
    }
    if (departureTime <= new Date()) {
      throw new BadRequestException('Departure must be in the future');
    }
    const durationMinutes = Math.round(
      (arrivalTime.getTime() - departureTime.getTime()) / 60000,
    );
    if (durationMinutes <= 0) {
      throw new BadRequestException(
        'Arrival must be after departure (remember both are in their own airport’s local time)',
      );
    }
    if (durationMinutes > MAX_DURATION_MINUTES) {
      throw new BadRequestException('A flight cannot last more than 24 hours');
    }
    return { departureTime, arrivalTime, durationMinutes };
  }

  private newCabin(dto: CreateCabinDto) {
    return {
      cabinClass: dto.cabinClass,
      totalSeats: dto.totalSeats,
      availableSeats: dto.totalSeats,
      price: dto.price,
      prices: this.fullPrices(dto.price),
      freeBags: dto.freeBags,
      maxBagWeightKg: dto.maxBagWeightKg,
    };
  }

  /** FLT-12: adult and child pay the cabin fare, infant pays 10% */
  private fullPrices(price: number): CabinPrices {
    const round = (n: number) => Math.round(n * 100) / 100;
    return { adult: price, child: price, infant: round(price * INFANT_SHARE) };
  }

  /**
   * FLT-03: the same airline cannot have two (not cancelled) flights with the same flight number
   * on the same departure date (local date at the departure airport).
   */
  private async assertNoDuplicate(
    airlineId: string,
    flightNumber: string,
    departureLocal: string,
    origin: AirportInfo,
    exceptId?: Types.ObjectId,
  ) {
    const date = departureLocal.slice(0, 10);
    const next = new Date(`${date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const dayStart = localToUtc(`${date}T00:00`, origin.timeZone);
    const dayEnd = localToUtc(
      `${next.toISOString().slice(0, 10)}T00:00`,
      origin.timeZone,
    );
    if (!dayStart || !dayEnd) return;
    const clash = await this.flightModel.exists({
      airline: new Types.ObjectId(airlineId),
      flightNumber: flightNumber.toUpperCase(),
      status: { $ne: FlightStatus.CANCELLED },
      departureTime: { $gte: dayStart, $lt: dayEnd },
      ...(exceptId && { _id: { $ne: exceptId } }),
    });
    if (clash) {
      throw new ConflictException(
        `Flight ${flightNumber.toUpperCase()} already departs on ${date} for this airline`,
      );
    }
  }

  /**
   * One-time upgrade of flights saved before the workbook fixes: one price per cabin, child pays
   * the full fare, free baggage per cabin, USD only. Runs at startup; does nothing once converted.
   */
  async onModuleInit() {
    const old = await this.flightModel.collection
      .find({
        $or: [
          { 'cabins.price': { $exists: false }, 'cabins.0': { $exists: true } },
          { currency: { $ne: PLATFORM_CURRENCY } },
        ],
      })
      .toArray();
    for (const f of old) {
      const cabins = ((f.cabins ?? []) as Record<string, unknown>[]).map(
        (c) => {
          const prices = (c.prices ?? {}) as { adult?: number };
          const price = (c.price as number) ?? prices.adult ?? 0;
          return {
            ...c,
            price,
            prices: this.fullPrices(price),
            freeBags: (c.freeBags as number) ?? 1,
            maxBagWeightKg: (c.maxBagWeightKg as number) ?? 23,
          };
        },
      );
      await this.flightModel.collection.updateOne(
        { _id: f._id },
        { $set: { cabins, currency: PLATFORM_CURRENCY } },
      );
    }
    if (old.length)
      this.logger.log(
        `Upgraded ${old.length} flight(s) to the new cabin format`,
      );
  }
}
