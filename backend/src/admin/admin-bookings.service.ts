import { BadRequestException, Injectable } from '@nestjs/common';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { FlightBookingsService } from '../flight-bookings/flight-bookings.service';
import { BookingStatus } from '../flight-bookings/schemas/flight-booking.schema';
import { HotelBookingsService } from '../hotel-bookings/hotel-bookings.service';
import { HotelBookingStatus } from '../hotel-bookings/schemas/hotel-booking.schema';
import {
  AdminBookingStatus,
  AdminBookingsQueryDto,
  AdminBookingType,
} from './dto/admin-bookings-query.dto';

/** ACC-17: the admin's view of all flight and hotel bookings */
@Injectable()
export class AdminBookingsService {
  constructor(
    private readonly flightBookings: FlightBookingsService,
    private readonly hotelBookings: HotelBookingsService,
  ) {}

  async list(query: AdminBookingsQueryDto) {
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? this.endOfDay(query.to) : undefined;
    if (from && to && from > to) {
      throw new BadRequestException('"from" must be before "to"');
    }

    // Keep page/limit and the skip getter from PaginationQueryDto
    const page = Object.assign(new PaginationQueryDto(), {
      page: query.page,
      limit: query.limit,
    });

    if (query.type === AdminBookingType.FLIGHT) {
      if (query.status === AdminBookingStatus.COMPLETED) {
        throw new BadRequestException('Flight bookings have no "completed" status');
      }
      return this.flightBookings.listAll(
        Object.assign(page, {
          status: query.status as BookingStatus | undefined,
          airlineId: query.providerId,
          userId: query.userId,
          from,
          to,
        }),
      );
    }

    return this.hotelBookings.listAll(
      Object.assign(page, {
        status: query.status as HotelBookingStatus | undefined,
        hotelId: query.providerId,
        userId: query.userId,
        from,
        to,
      }),
    );
  }

  /** "2026-11-30" means up to the end of that day; a full date-time is used as given */
  private endOfDay(value: string): Date {
    const d = new Date(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) d.setUTCHours(23, 59, 59, 999);
    return d;
  }
}
