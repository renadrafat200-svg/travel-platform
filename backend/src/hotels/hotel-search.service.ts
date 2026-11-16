import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter } from 'mongoose';
import { paginate } from '../common/dto/pagination-query.dto';
import { AuthUser } from '../common/interfaces/auth-user.interface';
import { PLATFORM_CURRENCY } from '../config/platform.constants';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import {
  AvailableRoomsQueryDto,
  HotelDetailsQueryDto,
  HotelSearchDto,
} from './dto/hotel.dto';
import { MAX_DAYS_AHEAD, MAX_NIGHTS } from './hotel.constants';
import { HotelsService } from './hotels.service';
import { RoomInventoryService } from './room-inventory.service';
import { Hotel, HotelDocument } from './schemas/hotel.schema';
import { Room } from './schemas/room.schema';
import { todayIn, validateRange } from './stay-dates.util';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Public hotel search (HTL-11, HTL-12), free rooms of a hotel (HTL-15) and the hotel details page (HTL-02) */
@Injectable()
export class HotelSearchService {
  constructor(
    @InjectModel(Hotel.name) private readonly hotelModel: Model<Hotel>,
    @InjectModel(Room.name) private readonly roomModel: Model<Room>,
    private readonly inventory: RoomInventoryService,
    private readonly hotels: HotelsService,
    private readonly reference: ReferenceDataService,
  ) {}

  /**
   * HTL-11 / HTL-12: active hotels in the city or country with at least `rooms` rooms free for the
   * whole stay whose combined max occupancy covers `guests`.
   * The price shown, filtered and sorted on is the price per night of the cheapest qualifying room.
   */
  async search(q: HotelSearchDto) {
    if (!q.city && !q.country)
      throw new BadRequestException('Give a city or a country to search in');
    if (q.city && !(await this.reference.findCity(q.city))) {
      throw new BadRequestException(
        `Unknown city ${q.city}. See GET /api/cities`,
      );
    }
    if (q.country && !(await this.reference.findCountry(q.country))) {
      throw new BadRequestException(
        `Unknown country ${q.country}. See GET /api/countries`,
      );
    }
    if (
      q.minPrice !== undefined &&
      q.maxPrice !== undefined &&
      q.minPrice > q.maxPrice
    ) {
      throw new BadRequestException('minPrice cannot be higher than maxPrice');
    }
    if (q.rooms > q.guests) {
      throw new BadRequestException(
        'Every room needs at least one guest, so rooms cannot be more than guests',
      );
    }

    const filter: QueryFilter<Hotel> = { isActive: true };
    if (q.city) filter.city = q.city;
    if (q.country) filter.country = q.country;
    if (q.minRating !== undefined) {
      // Unrated hotels are excluded when a rating filter is set
      filter.reviewCount = { $gt: 0 };
      filter.averageRating = { $gte: q.minRating };
    }
    const hotels = await this.hotelModel.find(filter).exec();

    // Dates are checked even when nothing matches, so a bad request always gets a 400
    const nights = this.stayNights(
      q.checkIn,
      q.checkOut,
      hotels[0]?.timeZone ?? (await this.zoneFor(q)),
    );
    const byHotel = await this.freeRoomsByHotel(hotels, q.checkIn, q.checkOut);

    const results = hotels.flatMap((h) => {
      const free = byHotel.get(h._id.toString()) ?? [];
      const cheapest = this.cheapestQualifying(free, q.rooms, q.guests);
      if (cheapest === null) return [];
      if (q.minPrice !== undefined && cheapest < q.minPrice) return [];
      if (q.maxPrice !== undefined && cheapest > q.maxPrice) return [];
      return [
        {
          hotel: this.hotels.summary(h),
          pricePerNight: cheapest,
          currency: PLATFORM_CURRENCY,
          freeRooms: free.length,
          nights: nights.length,
        },
      ];
    });

    const dir = q.order === 'desc' ? -1 : 1;
    const key = (r: (typeof results)[number]) =>
      q.sortBy === 'rating' ? (r.hotel.averageRating ?? 0) : r.pricePerNight;
    results.sort(
      (a, b) =>
        (key(a) - key(b)) * dir || a.hotel.name.localeCompare(b.hotel.name),
    );

    const start = (q.page - 1) * q.limit;
    return {
      search: {
        city: q.city,
        country: q.country,
        checkIn: q.checkIn,
        checkOut: q.checkOut,
        nights: nights.length,
        guests: q.guests,
        rooms: q.rooms,
      },
      ...paginate(
        results.slice(start, start + q.limit),
        results.length,
        q as never,
      ),
    };
  }

  /** HTL-15: rooms of one hotel free for the whole stay, with the total stay price */
  async availableRooms(
    hotelId: string,
    q: AvailableRoomsQueryDto,
    user?: AuthUser,
  ) {
    const hotel = await this.hotels.getVisible(hotelId, user);
    return this.availableRoomsOf(hotel, q.checkIn, q.checkOut);
  }

  /** HTL-02: details page with policies, rating, latest reviews, and free rooms when dates are given */
  async details(hotelId: string, q: HotelDetailsQueryDto, user?: AuthUser) {
    const hotel = await this.hotels.getVisible(hotelId, user);
    if (!!q.checkIn !== !!q.checkOut) {
      throw new BadRequestException(
        'Give both checkIn and checkOut to see the available rooms',
      );
    }
    return {
      ...this.hotels.toView(hotel),
      reviews: await this.hotels.latestReviews(hotel._id),
      availableRooms:
        q.checkIn && q.checkOut
          ? await this.availableRoomsOf(hotel, q.checkIn, q.checkOut)
          : undefined,
    };
  }

  // ---------- helpers ----------

  private async availableRoomsOf(
    hotel: HotelDocument,
    checkIn: string,
    checkOut: string,
  ) {
    const nights = this.stayNights(checkIn, checkOut, hotel.timeZone);
    const free =
      (await this.freeRoomsByHotel([hotel], checkIn, checkOut)).get(
        hotel._id.toString(),
      ) ?? [];
    free.sort(
      (a, b) =>
        a.pricePerNight - b.pricePerNight ||
        a.roomNumber.localeCompare(b.roomNumber),
    );
    return {
      hotel: this.hotels.summary(hotel),
      checkIn,
      checkOut,
      nights: nights.length,
      checkInTime: hotel.policies.checkInTime,
      checkOutTime: hotel.policies.checkOutTime,
      currency: PLATFORM_CURRENCY,
      items: free.map((r) => ({
        roomId: r._id.toString(),
        roomNumber: r.roomNumber,
        type: r.type,
        beds: r.beds,
        maxOccupancy: r.maxOccupancy,
        pricePerNight: r.pricePerNight,
        totalPrice: round2(r.pricePerNight * nights.length),
      })),
    };
  }

  /** Active rooms of these hotels that are bookable and free on every night of the stay */
  private async freeRoomsByHotel(
    hotels: Hotel[],
    checkIn: string,
    checkOut: string,
  ) {
    const out = new Map<string, Room[]>();
    if (hotels.length === 0) return out;
    // Hotels in one search share a city/country; dates are validated per hotel time zone by callers
    const nights = this.stayNights(checkIn, checkOut, hotels[0].timeZone);
    const rooms = await this.roomModel
      .find({ hotel: { $in: hotels.map((h) => h._id) }, isActive: true })
      .lean()
      .exec();
    const free = await this.inventory.freeRooms(
      rooms.map((r) => r._id),
      nights,
    );
    for (const r of rooms) {
      if (!free.has(r._id.toString())) continue;
      const k = r.hotel.toString();
      out.set(k, [...(out.get(k) ?? []), r]);
    }
    return out;
  }

  /**
   * Price per night of the cheapest room that can be part of a set of `count` free rooms
   * whose combined max occupancy covers `guests`. null = the hotel cannot fit the group.
   */
  private cheapestQualifying(
    free: Room[],
    count: number,
    guests: number,
  ): number | null {
    if (free.length < count) return null;
    const occ = free.map((r) => r.maxOccupancy).sort((a, b) => b - a);
    if (occ.slice(0, count).reduce((s, o) => s + o, 0) < guests) return null;

    let best: number | null = null;
    for (const room of free) {
      // the room plus the (count - 1) biggest OTHER rooms
      const others = [...free]
        .filter((r) => r !== room)
        .map((r) => r.maxOccupancy)
        .sort((a, b) => b - a)
        .slice(0, count - 1)
        .reduce((s, o) => s + o, 0);
      if (
        room.maxOccupancy + others >= guests &&
        (best === null || room.pricePerNight < best)
      ) {
        best = room.pricePerNight;
      }
    }
    return best;
  }

  /** HTL-11: check-out after check-in, check-in not in the past (in the hotel's time zone) */
  private stayNights(checkIn: string, checkOut: string, timeZone: string) {
    return validateRange(checkIn, checkOut, {
      today: todayIn(timeZone),
      maxNights: MAX_NIGHTS,
      maxDaysAhead: MAX_DAYS_AHEAD,
    });
  }

  /** Time zone used to judge "today" when no hotel matched: the searched city's airport */
  private async zoneFor(q: HotelSearchDto): Promise<string> {
    if (!q.city) return 'UTC';
    const airports = await this.reference.listAirports({
      city: q.city,
    } as never);
    return airports[0]?.timeZone ?? 'UTC';
  }
}
