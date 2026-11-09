import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter, Types } from 'mongoose';
import { AirlinesService } from '../airlines/airlines.service';
import { Paginated } from '../common/dto/pagination-query.dto';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { FlightSearchDto } from './dto/flight-search.dto';
import { FlightsService } from './flights.service';
import { Flight, FlightStatus } from './schemas/flight.schema';
import { localDayToUtcRange } from './time-zone.util';

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * FLT-11 (one-way and round-trip search), FLT-12 (filters), FLT-15 (sorting).
 * Public: guests can search without logging in.
 */
@Injectable()
export class FlightSearchService {
  constructor(
    @InjectModel(Flight.name) private readonly flightModel: Model<Flight>,
    private readonly flights: FlightsService,
    private readonly airlines: AirlinesService,
    private readonly reference: ReferenceDataService,
  ) {}

  async search(q: FlightSearchDto) {
    if (q.from === q.to) throw new BadRequestException('from and to must be different airports');
    if (q.infants > q.adults) {
      throw new BadRequestException(
        'Each infant must travel with an adult (infants cannot exceed adults)',
      );
    }
    if (q.minPrice !== undefined && q.maxPrice !== undefined && q.minPrice > q.maxPrice) {
      throw new BadRequestException('minPrice cannot be greater than maxPrice');
    }
    if (q.returnDate && q.returnDate < q.departureDate) {
      throw new BadRequestException('returnDate cannot be before departureDate');
    }

    const outbound = await this.searchLeg(q, q.from, q.to, q.departureDate);
    const result: Record<string, unknown> = {
      tripType: q.returnDate ? 'round_trip' : 'one_way',
      passengers: { adults: q.adults, children: q.children, infants: q.infants },
      cabinClass: q.cabinClass,
      outbound,
    };
    if (q.returnDate) {
      result.return = await this.searchLeg(q, q.to, q.from, q.returnDate);
    }
    return result;
  }

  /** One direction of the trip */
  private async searchLeg(
    q: FlightSearchDto,
    from: string,
    to: string,
    day: string,
  ): Promise<Paginated<ReturnType<FlightsService['toView']> & { pricing: unknown }>> {
    const [origin, destination] = await Promise.all([
      this.reference.findAirport(from),
      this.reference.findAirport(to),
    ]);
    if (!origin) throw new BadRequestException(`Unknown airport ${from}. See GET /api/airports`);
    if (!destination) throw new BadRequestException(`Unknown airport ${to}. See GET /api/airports`);

    // The date is a calendar day at the DEPARTURE airport, in its own time zone
    const range = localDayToUtcRange(day, origin.timeZone);
    if (!range) throw new BadRequestException(`${day} is not a valid date`);
    const now = new Date();
    const from_ = range.start > now ? range.start : now; // never show flights that already left

    // Flights of deactivated airlines are hidden and cannot be booked
    let airlineIds = await this.airlines.activeIds();
    if (q.airlineId) airlineIds = airlineIds.filter((id) => id.toString() === q.airlineId);

    const seats = q.adults + q.children; // infants sit on a lap
    const filter: QueryFilter<Flight> = {
      origin: from,
      destination: to,
      status: FlightStatus.SCHEDULED,
      departureTime: { $gte: from_, $lt: range.end },
      airline: { $in: airlineIds },
      'cabins.cabinClass': q.cabinClass,
    };
    const docs = await this.flightModel.find(filter).exec();

    // Keep flights whose chosen cabin still has enough seats, and price them for this group
    let rows = docs.flatMap((f) => {
      const cabin = f.cabins.find((c) => c.cabinClass === q.cabinClass);
      if (!cabin || cabin.availableSeats < seats) return [];
      const total = round(
        cabin.prices.adult * q.adults +
          cabin.prices.child * q.children +
          cabin.prices.infant * q.infants,
      );
      return [{ f, cabin, total }];
    });
    if (q.minPrice !== undefined) rows = rows.filter((r) => r.total >= q.minPrice!);
    if (q.maxPrice !== undefined) rows = rows.filter((r) => r.total <= q.maxPrice!);

    const key = {
      price: (r: (typeof rows)[number]) => r.total,
      departureTime: (r: (typeof rows)[number]) => r.f.departureTime.getTime(),
      arrivalTime: (r: (typeof rows)[number]) => r.f.arrivalTime.getTime(),
      duration: (r: (typeof rows)[number]) => r.f.durationMinutes,
    }[q.sortBy];
    const dir = q.order === 'desc' ? -1 : 1;
    rows.sort(
      (a, b) =>
        (key(a) - key(b)) * dir || a.f.departureTime.getTime() - b.f.departureTime.getTime(),
    );

    const total = rows.length;
    const pageRows = rows.slice((q.page - 1) * q.limit, q.page * q.limit);
    const [airlineMap, airports] = await Promise.all([
      this.airlines.summaries(pageRows.map((r) => r.f.airline as Types.ObjectId)),
      this.flights.airportMap([from, to]),
    ]);

    const items = pageRows.map((r) => ({
      ...this.flights.toView(r.f, airlineMap.get(r.f.airline.toString()), airports),
      pricing: {
        cabinId: r.cabin._id.toString(),
        cabinClass: r.cabin.cabinClass,
        seatsLeft: r.cabin.availableSeats,
        perPassenger: r.cabin.prices,
        totalPrice: r.total,
        currency: r.f.currency,
      },
    }));
    return { items, total, page: q.page, limit: q.limit, totalPages: Math.ceil(total / q.limit) };
  }
}
