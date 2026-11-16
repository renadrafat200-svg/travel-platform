import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { randomInt } from 'crypto';
import { ClientSession, Connection, Model, QueryFilter, Types } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import {
  paginate,
  PaginationQueryDto,
} from '../common/dto/pagination-query.dto';
import { ProviderType, Role } from '../common/enums/role.enum';
import { AuthUser } from '../common/interfaces/auth-user.interface';
import {
  assertManagesProvider,
  assertOwnerOrAdmin,
} from '../common/utils/ownership';
import { PLATFORM_CURRENCY } from '../config/platform.constants';
import {
  HOTEL_HOLD_MINUTES,
  MAX_DAYS_AHEAD,
  MAX_NIGHTS,
} from '../hotels/hotel.constants';
import { HotelsService } from '../hotels/hotels.service';
import { RoomInventoryService } from '../hotels/room-inventory.service';
import { RoomNightKind } from '../hotels/schemas/room-night.schema';
import { Room } from '../hotels/schemas/room.schema';
import {
  localMoment,
  nightsBetween,
  todayIn,
  validateRange,
} from '../hotels/stay-dates.util';
import { utcToLocal } from '../flights/time-zone.util';
import { UsersService } from '../users/users.service';
import {
  CancelHotelBookingDto,
  CreateHotelBookingDto,
  HotelReservationsQueryDto,
  MyHotelBookingsQueryDto,
  ReservationGroup,
} from './dto/hotel-booking.dto';
import {
  BookedCancellationTier,
  BookedRoom,
  HotelBooking,
  HotelBookingDocument,
  HotelBookingStatus as Status,
  HotelRefundStatus,
} from './schemas/hotel-booking.schema';

const MINUTE = 60_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** No 0/O or 1/I, so references are easy to read out loud. Hotel references start with H. */
const REFERENCE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** HTL-20 groups */
const GROUP_FILTERS: Record<
  ReservationGroup,
  { statuses: Status[]; sort: Record<string, 1 | -1> }
> = {
  upcoming: {
    statuses: [Status.PENDING, Status.CONFIRMED],
    sort: { checkIn: 1, _id: 1 },
  },
  past: { statuses: [Status.COMPLETED], sort: { checkIn: -1, _id: -1 } },
  cancelled: {
    statuses: [Status.CANCELLED, Status.EXPIRED],
    sort: { updatedAt: -1, _id: -1 },
  },
};

/**
 * HTL-10: the tier with the highest threshold not exceeding the days remaining; no tier = 0%.
 * Exported so Payments and tests use exactly the same rule.
 */
export function refundPercentFor(
  tiers: BookedCancellationTier[],
  daysRemaining: number,
): number {
  const match = tiers
    .filter((t) => t.daysBeforeCheckIn <= daysRemaining)
    .sort((a, b) => b.daysBeforeCheckIn - a.daysBeforeCheckIn)[0];
  return match?.refundPercent ?? 0;
}

@Injectable()
export class HotelBookingsService {
  private readonly logger = new Logger(HotelBookingsService.name);

  constructor(
    @InjectModel(HotelBooking.name)
    private readonly bookingModel: Model<HotelBooking>,
    @InjectModel(Room.name) private readonly roomModel: Model<Room>,
    @InjectConnection() private readonly connection: Connection,
    private readonly hotels: HotelsService,
    private readonly inventory: RoomInventoryService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  // =====================================================================================
  // Booking (HTL-16, HTL-18)
  // =====================================================================================

  /**
   * One reservation for one or more rooms of one hotel, same dates. All rooms are held together
   * for 10 minutes as ONE Pending Payment reservation.
   *
   * Inside a MongoDB transaction we save the reservation and take every night of every room.
   * If any room overlaps a Confirmed reservation, an unexpired hold or a blocked range, the
   * unique (room, night) index rejects it, the transaction is rolled back and NOTHING is held.
   */
  async create(user: AuthUser, dto: CreateHotelBookingDto) {
    // 1. Active hotel, valid dates (check-out after check-in, check-in not in the past)
    const hotel = await this.hotels.getById(dto.hotelId);
    if (!hotel.isActive) throw new NotFoundException('Hotel not found');
    const nights = validateRange(dto.checkIn, dto.checkOut, {
      today: todayIn(hotel.timeZone),
      maxNights: MAX_NIGHTS,
      maxDaysAhead: MAX_DAYS_AHEAD,
    });

    // 2. Different, active rooms of this hotel; guests per room within max occupancy
    const ids = dto.rooms.map((r) => r.roomId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException(
        'Each room can only appear once in a reservation',
      );
    }
    const rooms = await this.roomModel
      .find({ _id: { $in: ids }, hotel: hotel._id, isActive: true })
      .exec();
    if (rooms.length !== ids.length) {
      throw new NotFoundException(
        'One of the rooms does not exist in this hotel or is deactivated',
      );
    }
    const byId = new Map(rooms.map((r) => [r._id.toString(), r]));
    const booked: BookedRoom[] = dto.rooms.map((sel) => {
      const room = byId.get(sel.roomId)!;
      const children = sel.children ?? 0;
      const guests = sel.adults + children;
      if (guests < 1)
        throw new BadRequestException(
          `Room ${room.roomNumber} needs at least one guest`,
        );
      if (guests > room.maxOccupancy) {
        throw new BadRequestException(
          `Room ${room.roomNumber} fits at most ${room.maxOccupancy} guest(s), not ${guests}`,
        );
      }
      return {
        room: room._id,
        roomNumber: room.roomNumber,
        type: room.type,
        beds: room.beds,
        maxOccupancy: room.maxOccupancy,
        adults: sel.adults,
        children,
        pricePerNight: room.pricePerNight,
        amount: round2(room.pricePerNight * nights.length),
      };
    });
    const totalAdults = booked.reduce((s, r) => s + r.adults, 0);
    if (totalAdults < 1)
      throw new BadRequestException('A reservation needs at least one adult');

    // 3. Every night must be inside one of each room's bookable date ranges (HTL-04)
    const covered = await this.inventory.coveredRooms(
      rooms.map((r) => r._id),
      nights,
    );
    const notBookable = booked.filter((r) => !covered.has(r.room.toString()));
    if (notBookable.length) {
      throw new ConflictException(
        `Room ${notBookable.map((r) => r.roomNumber).join(', ')} is not bookable on these dates. Nothing was reserved.`,
      );
    }

    // 4. Free these rooms from holds that ran out a moment ago (the job runs once a minute)
    await this.expireOverdue({
      'rooms.room': { $in: rooms.map((r) => r._id) },
    });

    const account = await this.users.findById(user.id);
    const base = {
      user: new Types.ObjectId(user.id),
      hotel: hotel._id,
      hotelName: hotel.name,
      city: hotel.city,
      country: hotel.country,
      checkIn: localMoment(
        dto.checkIn,
        hotel.policies.checkInTime,
        hotel.timeZone,
      ),
      checkOut: localMoment(
        dto.checkOut,
        hotel.policies.checkOutTime,
        hotel.timeZone,
      ),
      checkInDate: dto.checkIn,
      checkOutDate: dto.checkOut,
      timeZone: hotel.timeZone,
      nights: nights.length,
      rooms: booked,
      totalAdults,
      totalChildren: booked.reduce((s, r) => s + r.children, 0),
      guestName:
        [account?.firstName, account?.lastName].filter(Boolean).join(' ') ||
        user.email,
      guestEmail: user.email,
      totalAmount: round2(booked.reduce((s, r) => s + r.amount, 0)),
      currency: PLATFORM_CURRENCY,
      cancellationTiers: hotel.policies.cancellationTiers.map((t) => ({
        daysBeforeCheckIn: t.daysBeforeCheckIn,
        refundPercent: t.refundPercent,
      })),
      status: Status.PENDING,
    };

    // 5. Save the reservation and take all its nights in one transaction
    for (let attempt = 1; ; attempt++) {
      try {
        const booking = await this.inTransaction(async (session) => {
          const [doc] = await this.bookingModel.create(
            [
              {
                ...base,
                reference: this.newReference(),
                holdExpiresAt: new Date(
                  Date.now() + HOTEL_HOLD_MINUTES * MINUTE,
                ),
              },
            ],
            { session },
          );
          await this.inventory.claim(
            booked.map((r) => ({ room: r.room, hotel: hotel._id, nights })),
            { kind: RoomNightKind.BOOKING, id: doc._id },
            session,
          );
          return doc;
        });
        return this.toView(booking);
      } catch (err) {
        // Two reservations drew the same random reference: try again with a new one
        const dupReference = (err as { keyPattern?: Record<string, unknown> })
          ?.keyPattern?.reference;
        if (dupReference && attempt < 5) continue;
        throw err;
      }
    }
  }

  // =====================================================================================
  // Viewing (HTL-20, HTL-22)
  // =====================================================================================

  /** HTL-20: my reservations grouped as Upcoming, Past and Cancelled */
  async findMine(user: AuthUser, query: MyHotelBookingsQueryDto) {
    const mine = { user: new Types.ObjectId(user.id) };
    await this.refreshStatuses(mine);

    const page = async (group: ReservationGroup) => {
      const { statuses, sort } = GROUP_FILTERS[group];
      const filter = { ...mine, status: { $in: statuses } };
      const [docs, total] = await Promise.all([
        this.bookingModel
          .find(filter)
          .sort(sort)
          .skip(query.skip)
          .limit(query.limit)
          .exec(),
        this.bookingModel.countDocuments(filter).exec(),
      ]);
      return paginate(
        docs.map((d) => this.summaryView(d)),
        total,
        query,
      );
    };
    if (query.group)
      return { group: query.group, ...(await page(query.group)) };
    const [upcoming, past, cancelled] = await Promise.all([
      page('upcoming'),
      page('past'),
      page('cancelled'),
    ]);
    return { upcoming, past, cancelled };
  }

  /** HTL-20: full details of one reservation (owner or admin only) */
  async findOne(user: AuthUser, id: string) {
    await this.refreshStatuses({ _id: this.oid(id) });
    return this.toView(await this.getOwned(user, id));
  }

  /** HTL-22: reservations of the moderator's own hotel (guest, dates, status) */
  async reservations(
    user: AuthUser,
    hotelId: string,
    query: HotelReservationsQueryDto,
  ) {
    const hotel = await this.hotels.getById(hotelId);
    assertManagesProvider(user, ProviderType.HOTEL, hotel._id);
    await this.refreshStatuses({ hotel: hotel._id });

    const filter: QueryFilter<HotelBooking> = { hotel: hotel._id };
    if (query.status) filter.status = query.status;
    if (query.from) filter.checkOutDate = { $gt: query.from };
    if (query.to) filter.checkInDate = { $lt: query.to };
    if (query.roomId) filter['rooms.room'] = new Types.ObjectId(query.roomId);

    const [docs, total] = await Promise.all([
      this.bookingModel
        .find(filter)
        .sort({ checkIn: 1, _id: 1 })
        .skip(query.skip)
        .limit(query.limit)
        .exec(),
      this.bookingModel.countDocuments(filter).exec(),
    ]);
    const items = docs.map((b) => ({
      id: b._id.toString(),
      reference: b.reference,
      status: b.status,
      guest: { name: b.guestName, email: b.guestEmail },
      checkIn: b.checkInDate,
      checkOut: b.checkOutDate,
      nights: b.nights,
      rooms: b.rooms.map((r) => ({
        roomId: r.room.toString(),
        roomNumber: r.roomNumber,
        adults: r.adults,
        children: r.children,
      })),
      totalAdults: b.totalAdults,
      totalChildren: b.totalChildren,
      totalAmount: b.totalAmount,
      currency: b.currency,
      createdAt: b.createdAt,
    }));
    return {
      hotel: this.hotels.summary(hotel),
      ...paginate(items, total, query),
    };
  }

  // =====================================================================================
  // Cancelling (HTL-21)
  // =====================================================================================

  /** HTL-21: what the user would get back if they cancelled now (shown before cancelling) */
  async refundPreview(user: AuthUser, id: string) {
    const booking = await this.getOwned(user, id);
    const quote = this.quoteCancellation(booking);
    return {
      bookingId: booking._id.toString(),
      reference: booking.reference,
      checkIn: booking.checkInDate,
      totalAmount: booking.totalAmount,
      currency: booking.currency,
      daysBeforeCheckIn: quote.daysRemaining,
      refundPercent: quote.refundPercent,
      refundAmount: quote.refundAmount,
      cancellationTiers: booking.cancellationTiers.map((t) => ({
        daysBeforeCheckIn: t.daysBeforeCheckIn,
        refundPercent: t.refundPercent,
      })),
    };
  }

  /**
   * HTL-21: the owner cancels a CONFIRMED reservation as a whole, before the check-in date.
   * Refund = the hotel's tiers (as they were when booked) on the full total. The rooms are released.
   */
  async cancel(user: AuthUser, id: string, dto: CancelHotelBookingDto) {
    const booking = await this.getOwned(user, id);
    const quote = this.quoteCancellation(booking);
    const updated = await this.closeAndRelease(booking, Status.CONFIRMED, {
      status: Status.CANCELLED,
      cancelledAt: new Date(),
      cancelledBy: user.role === Role.ADMIN ? 'admin' : 'user',
      cancellationReason: dto.reason,
      refundPercent: quote.refundPercent,
      refundAmount: quote.refundAmount,
      refundStatus:
        quote.refundAmount > 0
          ? HotelRefundStatus.PENDING
          : HotelRefundStatus.NONE,
    });
    // TODO (Member 6): create the Stripe refund for refundAmount, then call markRefunded(id, refundId).
    // TODO (Member 6): NotificationsService.notify(user, 'booking.cancelled', ...)
    return this.toView(updated);
  }

  /**
   * The hotel cancels a guest's confirmed reservation (closure, overbooking ...).
   * PAY-03: provider cancellations refund 100%.
   */
  async cancelByHotel(
    user: AuthUser,
    hotelId: string,
    bookingId: string,
    dto: CancelHotelBookingDto,
  ) {
    const hotel = await this.hotels.getById(hotelId);
    assertManagesProvider(user, ProviderType.HOTEL, hotel._id);
    const booking = await this.getById(bookingId);
    if (!booking.hotel.equals(hotel._id))
      throw new NotFoundException('Reservation not found in this hotel');
    if (booking.status !== Status.CONFIRMED) {
      throw new BadRequestException(
        `Only confirmed reservations can be cancelled (this one is ${booking.status})`,
      );
    }
    if (booking.checkOut.getTime() <= Date.now())
      throw new BadRequestException('This stay is already over');

    const updated = await this.closeAndRelease(booking, Status.CONFIRMED, {
      status: Status.CANCELLED,
      cancelledAt: new Date(),
      cancelledBy: user.role === Role.ADMIN ? 'admin' : 'hotel',
      cancellationReason: dto.reason ?? 'Cancelled by the hotel',
      refundPercent: 100,
      refundAmount: booking.totalAmount,
      refundStatus:
        booking.totalAmount > 0
          ? HotelRefundStatus.PENDING
          : HotelRefundStatus.NONE,
    });
    await this.audit.log(user, {
      action: 'hotel.booking.cancel',
      targetType: 'hotel',
      targetId: hotel._id,
      details: {
        bookingId: booking._id.toString(),
        reference: booking.reference,
      },
    });
    // TODO (Member 6): refund in full and notify the guest.
    return this.toView(updated);
  }

  // =====================================================================================
  // Automatic status changes (HTL-18, HTL-23)
  // =====================================================================================

  /** Pending Payment -> Expired after 10 minutes unpaid; the rooms are released. */
  async expireOverdue(
    extraFilter: QueryFilter<HotelBooking> = {},
  ): Promise<number> {
    const overdue = await this.bookingModel
      .find({
        ...extraFilter,
        status: Status.PENDING,
        holdExpiresAt: { $lte: new Date() },
      })
      .limit(500)
      .exec();
    let count = 0;
    for (const b of overdue) {
      try {
        await this.closeAndRelease(b, Status.PENDING, {
          status: Status.EXPIRED,
          expiredAt: new Date(),
        });
        count++;
      } catch (err) {
        // Paid or expired by someone else in the meantime: nothing to do
        if (!(err instanceof ConflictException)) throw err;
      }
    }
    return count;
  }

  /** HTL-23: Confirmed -> Completed once the check-out time has passed */
  async completeFinished(
    extraFilter: QueryFilter<HotelBooking> = {},
  ): Promise<number> {
    const res = await this.bookingModel
      .updateMany(
        {
          ...extraFilter,
          status: Status.CONFIRMED,
          checkOut: { $lte: new Date() },
        },
        { $set: { status: Status.COMPLETED, completedAt: new Date() } },
      )
      .exec();
    return res.modifiedCount;
  }

  // =====================================================================================
  // For Member 6 (payments). Same names as the flight booking service.
  // =====================================================================================

  /** What to charge. Throws if the reservation is not the user's, not pending, or the hold ran out. */
  async getForPayment(user: AuthUser, id: string) {
    const booking = await this.getOwned(user, id);
    if (booking.status !== Status.PENDING) {
      throw new BadRequestException(
        `This reservation is ${booking.status} and cannot be paid`,
      );
    }
    if (booking.holdExpiresAt.getTime() <= Date.now()) {
      throw new BadRequestException(
        'The 10-minute room hold expired. Book again.',
      );
    }
    return {
      bookingType: 'hotel' as const,
      bookingId: booking._id.toString(),
      reference: booking.reference,
      user: booking.user.toString(),
      amount: booking.totalAmount,
      currency: booking.currency,
      holdExpiresAt: booking.holdExpiresAt,
    };
  }

  /**
   * HTL-17: call ONLY from the Stripe webhook after the payment succeeded.
   * Pending -> Confirmed. 409 if the hold already expired (then Member 6 refunds the payment).
   */
  async confirm(id: string, paymentIntentId: string) {
    const booking = await this.getById(id);
    if (
      booking.status === Status.CONFIRMED &&
      booking.paymentReference === paymentIntentId
    ) {
      return this.toView(booking); // webhook retried
    }
    const confirmed = await this.bookingModel
      .findOneAndUpdate(
        {
          _id: booking._id,
          status: Status.PENDING,
          holdExpiresAt: { $gt: new Date() },
        },
        {
          $set: {
            status: Status.CONFIRMED,
            confirmedAt: new Date(),
            paymentReference: paymentIntentId,
          },
        },
        { returnDocument: 'after' },
      )
      .exec();
    if (!confirmed)
      throw new ConflictException(
        'The room hold expired, so the reservation cannot be confirmed',
      );
    // TODO (Member 6): NotificationsService.notify(user, 'booking.confirmed', ...)
    return this.toView(confirmed);
  }

  /** PAY-03: Member 6 calls this when the Stripe refund succeeded (or failed) */
  async markRefunded(id: string, refundReference?: string, failed = false) {
    await this.bookingModel
      .updateOne(
        {
          _id: this.oid(id),
          refundStatus: {
            $in: [HotelRefundStatus.PENDING, HotelRefundStatus.FAILED],
          },
        },
        {
          $set: {
            refundStatus: failed
              ? HotelRefundStatus.FAILED
              : HotelRefundStatus.REFUNDED,
            ...(refundReference && { refundReference }),
          },
        },
      )
      .exec();
  }

  // =====================================================================================
  // For teammates
  // =====================================================================================

  /**
   * Member 5 (reviews, HTL-23/24): a user may only review after a COMPLETED reservation of their own.
   * Returns the hotel id to attach the review to; 403 if not theirs, 400 if not completed.
   */
  async getCompletedStay(user: AuthUser, bookingId: string) {
    await this.completeFinished({ _id: this.oid(bookingId) });
    const booking = await this.getById(bookingId);
    if (!booking.user.equals(user.id)) {
      throw new ForbiddenException(
        'You can only review stays you booked yourself',
      );
    }
    if (booking.status !== Status.COMPLETED) {
      throw new BadRequestException(
        'You can review a hotel only after a completed stay',
      );
    }
    return {
      bookingId: booking._id.toString(),
      hotelId: booking.hotel.toString(),
      checkIn: booking.checkInDate,
      checkOut: booking.checkOutDate,
    };
  }

  /** Member 1 (ACC-17): every hotel reservation, filterable by status, hotel, user and check-in date range */
  async listAll(
    query: PaginationQueryDto & {
      status?: Status;
      hotelId?: string;
      userId?: string;
      from?: Date;
      to?: Date;
    },
  ) {
    await this.refreshStatuses();
    const filter: QueryFilter<HotelBooking> = {};
    if (query.status) filter.status = query.status;
    if (query.hotelId) filter.hotel = this.oid(query.hotelId);
    if (query.userId) filter.user = this.oid(query.userId);
    if (query.from || query.to) {
      filter.checkIn = {
        ...(query.from && { $gte: query.from }),
        ...(query.to && { $lte: query.to }),
      };
    }
    const [docs, total] = await Promise.all([
      this.bookingModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(query.skip)
        .limit(query.limit)
        .exec(),
      this.bookingModel.countDocuments(filter).exec(),
    ]);
    return paginate(
      docs.map((d) => this.toView(d)),
      total,
      query,
    );
  }

  // =====================================================================================
  // Private helpers
  // =====================================================================================

  /** Brings statuses up to date before reading (the job also does this every minute) */
  private async refreshStatuses(filter: QueryFilter<HotelBooking> = {}) {
    await this.expireOverdue(filter);
    await this.completeFinished(filter);
  }

  /** Days left before the check-in date and the refund for cancelling today. Throws if cancelling is not allowed. */
  private quoteCancellation(booking: HotelBooking) {
    if (booking.status !== Status.CONFIRMED) {
      throw new BadRequestException(
        booking.status === Status.PENDING
          ? 'This reservation is not paid yet; an unpaid hold simply expires after 10 minutes'
          : `Only confirmed reservations can be cancelled (this one is ${booking.status})`,
      );
    }
    const daysRemaining = nightsBetween(
      todayIn(booking.timeZone),
      booking.checkInDate,
    );
    if (daysRemaining < 1) {
      throw new BadRequestException(
        'Reservations can only be cancelled before the check-in date',
      );
    }
    const refundPercent = refundPercentFor(
      booking.cancellationTiers,
      daysRemaining,
    );
    return {
      daysRemaining,
      refundPercent,
      refundAmount: round2((booking.totalAmount * refundPercent) / 100),
    };
  }

  /**
   * Moves a reservation out of `expected` and frees its nights, both in one transaction.
   * The status condition makes races safe (e.g. cancel vs expiry job): only one wins.
   */
  private async closeAndRelease(
    booking: HotelBookingDocument,
    expected: Status,
    set: Partial<HotelBooking>,
  ): Promise<HotelBookingDocument> {
    return this.inTransaction(async (session) => {
      const updated = await this.bookingModel
        .findOneAndUpdate(
          { _id: booking._id, status: expected },
          { $set: set },
          { returnDocument: 'after', session },
        )
        .exec();
      if (!updated)
        throw new ConflictException(
          'This reservation changed meanwhile; please reload it',
        );
      await this.inventory.releaseBooking(booking._id, session);
      return updated;
    });
  }

  private async inTransaction<T>(
    work: (session: ClientSession) => Promise<T>,
  ): Promise<T> {
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(() => work(session));
    } finally {
      await session.endSession();
    }
  }

  private oid(id: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(id))
      throw new BadRequestException('Invalid reservation id');
    return new Types.ObjectId(id);
  }

  private async getById(id: string): Promise<HotelBookingDocument> {
    const booking = await this.bookingModel.findById(this.oid(id)).exec();
    if (!booking) throw new NotFoundException('Reservation not found');
    return booking;
  }

  private async getOwned(
    user: AuthUser,
    id: string,
  ): Promise<HotelBookingDocument> {
    const booking = await this.getById(id);
    assertOwnerOrAdmin(user, booking.user);
    return booking;
  }

  private newReference(): string {
    let ref = 'H';
    for (let i = 0; i < 5; i++)
      ref += REFERENCE_CHARS[randomInt(REFERENCE_CHARS.length)];
    return ref;
  }

  /** HTL-20 list item: reference, hotel, rooms, dates, guests, total, status */
  summaryView(b: HotelBookingDocument) {
    return {
      id: b._id.toString(),
      reference: b.reference,
      status: b.status,
      hotel: { id: b.hotel.toString(), name: b.hotelName, city: b.city },
      checkIn: b.checkInDate,
      checkOut: b.checkOutDate,
      // HTL-09: standard check-in / check-out times on the booking summary (hotel local time)
      checkInTime: utcToLocal(b.checkIn, b.timeZone).slice(11, 16),
      checkOutTime: utcToLocal(b.checkOut, b.timeZone).slice(11, 16),
      nights: b.nights,
      rooms: b.rooms.map((r) => ({ roomNumber: r.roomNumber, type: r.type })),
      guests: { adults: b.totalAdults, children: b.totalChildren },
      totalAmount: b.totalAmount,
      currency: b.currency,
      holdExpiresAt: b.status === Status.PENDING ? b.holdExpiresAt : undefined,
    };
  }

  toView(b: HotelBookingDocument) {
    return {
      ...this.summaryView(b),
      bookingType: 'hotel' as const,
      checkInAt: b.checkIn,
      checkOutAt: b.checkOut,
      rooms: b.rooms.map((r) => ({
        roomId: r.room.toString(),
        roomNumber: r.roomNumber,
        type: r.type,
        beds: r.beds,
        adults: r.adults,
        children: r.children,
        pricePerNight: r.pricePerNight,
        amount: r.amount,
      })),
      guestName: b.guestName,
      cancellationTiers: b.cancellationTiers.map((t) => ({
        daysBeforeCheckIn: t.daysBeforeCheckIn,
        refundPercent: t.refundPercent,
      })),
      confirmedAt: b.confirmedAt,
      paymentReference: b.paymentReference,
      completedAt: b.completedAt,
      expiredAt: b.expiredAt,
      cancelledAt: b.cancelledAt,
      cancelledBy: b.cancelledBy,
      cancellationReason: b.cancellationReason,
      refundPercent: b.refundPercent,
      refundAmount: b.refundAmount,
      refundStatus: b.refundStatus,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
    };
  }
}
