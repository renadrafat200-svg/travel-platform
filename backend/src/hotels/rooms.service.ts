import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, QueryFilter, Types } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/interfaces/auth-user.interface';
import { PLATFORM_CURRENCY } from '../config/platform.constants';
import {
  CreateRoomBlockDto,
  CreateRoomDto,
  DateRangeDto,
  RoomCalendarQueryDto,
  RoomListQueryDto,
  UpdateRoomDto,
} from './dto/room.dto';
import { MAX_DAYS_AHEAD, MAX_RANGE_NIGHTS } from './hotel.constants';
import { HotelsService } from './hotels.service';
import { RoomInventoryService } from './room-inventory.service';
import { RoomBlock, RoomBlockDocument } from './schemas/room-block.schema';
import { RoomNightKind } from './schemas/room-night.schema';
import { RoomRange } from './schemas/room-range.schema';
import { Room, RoomDocument } from './schemas/room.schema';
import {
  nightsBetween,
  nightsOf,
  todayIn,
  validateRange,
} from './stay-dates.util';

const later = (a: string, b: string) => (a > b ? a : b);

/** Rooms, bookable ranges, blocked dates and the room calendar of one hotel (moderator side) */
@Injectable()
export class RoomsService {
  constructor(
    @InjectModel(Room.name) private readonly roomModel: Model<Room>,
    @InjectModel(RoomRange.name) private readonly rangeModel: Model<RoomRange>,
    @InjectModel(RoomBlock.name) private readonly blockModel: Model<RoomBlock>,
    @InjectConnection() private readonly connection: Connection,
    private readonly hotels: HotelsService,
    private readonly inventory: RoomInventoryService,
    private readonly audit: AuditService,
  ) {}

  // =====================================================================================
  // Rooms (HTL-03, HTL-05, HTL-06)
  // =====================================================================================

  /** HTL-03. The room is bookable once the moderator adds a bookable date range (HTL-04). */
  async create(user: AuthUser, hotelId: string, dto: CreateRoomDto) {
    const hotel = await this.hotels.getManageable(user, hotelId);
    const room = await this.roomModel.create({ ...dto, hotel: hotel._id });
    await this.log(user, hotel._id, 'hotel.room.create', room);
    return this.toView(room);
  }

  /** Public: rooms of an active hotel. Its moderator and admins can also see deactivated rooms. */
  async findAll(hotelId: string, query: RoomListQueryDto, user?: AuthUser) {
    const hotel = await this.hotels.getVisible(hotelId, user);
    const filter: QueryFilter<Room> = { hotel: hotel._id };
    if (!(query.includeInactive && this.hotels.canManage(user, hotel._id)))
      filter.isActive = true;
    const rooms = await this.roomModel
      .find(filter)
      .sort({ roomNumber: 1 })
      .exec();
    return {
      hotel: this.hotels.summary(hotel),
      items: rooms.map((r) => this.toView(r)),
    };
  }

  async findOne(hotelId: string, roomId: string, user?: AuthUser) {
    const hotel = await this.hotels.getVisible(hotelId, user);
    const room = await this.getRoom(hotel._id, roomId);
    if (!room.isActive && !this.hotels.canManage(user, hotel._id)) {
      throw new NotFoundException('Room not found');
    }
    return {
      ...this.toView(room),
      bookableRanges: await this.rangesOf(room._id),
    };
  }

  /** HTL-05: edit beds, occupancy, price ... Existing reservations keep the price they were booked at. */
  async update(
    user: AuthUser,
    hotelId: string,
    roomId: string,
    dto: UpdateRoomDto,
  ) {
    const hotel = await this.hotels.getManageable(user, hotelId);
    const room = await this.getRoom(hotel._id, roomId);
    room.set(dto);
    await room.save();
    await this.log(user, hotel._id, 'hotel.room.update', room, {
      fields: Object.keys(dto),
    });
    return this.toView(room);
  }

  /** HTL-06: rejected while the room has a Confirmed or Pending Payment reservation that is not over */
  async deactivate(user: AuthUser, hotelId: string, roomId: string) {
    const hotel = await this.hotels.getManageable(user, hotelId);
    const room = await this.getRoom(hotel._id, roomId);
    await this.assertNoReservations(
      room,
      todayIn(hotel.timeZone),
      undefined,
      'deactivate',
    );
    room.isActive = false;
    await room.save();
    await this.log(user, hotel._id, 'hotel.room.deactivate', room);
    return this.toView(room);
  }

  async reactivate(user: AuthUser, hotelId: string, roomId: string) {
    const hotel = await this.hotels.getManageable(user, hotelId);
    const room = await this.getRoom(hotel._id, roomId);
    room.isActive = true;
    await room.save();
    await this.log(user, hotel._id, 'hotel.room.reactivate', room);
    return this.toView(room);
  }

  /** HTL-06: deleting is only allowed for a room that was never reserved. Otherwise deactivate it. */
  async remove(user: AuthUser, hotelId: string, roomId: string) {
    const hotel = await this.hotels.getManageable(user, hotelId);
    const room = await this.getRoom(hotel._id, roomId);
    const everReserved = await this.connection
      .collection('hotelbookings')
      .findOne({ 'rooms.room': room._id }, { projection: { _id: 1 } });
    if (everReserved) {
      throw new ConflictException(
        'This room has been reserved before, so it cannot be deleted. Deactivate it instead.',
      );
    }
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        await this.inventory.deleteAllOfRoom(room._id, session);
        await this.blockModel
          .deleteMany({ room: room._id }, { session })
          .exec();
        await this.roomModel.deleteOne({ _id: room._id }, { session }).exec();
      });
    } finally {
      await session.endSession();
    }
    await this.log(user, hotel._id, 'hotel.room.delete', room);
    return { deleted: true };
  }

  // =====================================================================================
  // Bookable date ranges (HTL-04, HTL-05)
  // =====================================================================================

  /** HTL-04: add a range of nights when the room can be booked. Ranges of one room never overlap. */
  async addRange(
    user: AuthUser,
    hotelId: string,
    roomId: string,
    dto: DateRangeDto,
  ) {
    const hotel = await this.hotels.getManageable(user, hotelId);
    const room = await this.getRoom(hotel._id, roomId);
    this.checkRange(dto, todayIn(hotel.timeZone));
    await this.assertNoOverlappingRange(room._id, dto);
    const range = await this.rangeModel.create({
      room: room._id,
      hotel: hotel._id,
      from: dto.from,
      to: dto.to,
    });
    await this.log(user, hotel._id, 'hotel.room.availability.add', room, {
      from: dto.from,
      to: dto.to,
    });
    return this.rangeView(range);
  }

  async listRanges(hotelId: string, roomId: string, user?: AuthUser) {
    const hotel = await this.hotels.getVisible(hotelId, user);
    const room = await this.getRoom(hotel._id, roomId);
    return { room: this.toView(room), items: await this.rangesOf(room._id) };
  }

  /**
   * HTL-05: change a range. Nights that would stop being bookable must not have a Confirmed
   * (or Pending Payment) reservation.
   */
  async updateRange(
    user: AuthUser,
    hotelId: string,
    roomId: string,
    rangeId: string,
    dto: DateRangeDto,
  ) {
    const hotel = await this.hotels.getManageable(user, hotelId);
    const room = await this.getRoom(hotel._id, roomId);
    const range = await this.getRange(room._id, rangeId);
    const today = todayIn(hotel.timeZone);
    this.checkRange(dto, today);
    await this.assertNoOverlappingRange(room._id, dto, range._id);

    // Nights in the old range but not in the new one: before the new start, and after the new end
    if (dto.from > range.from) {
      await this.assertNoReservations(
        room,
        later(range.from, today),
        dto.from,
        'remove availability',
      );
    }
    if (dto.to < range.to) {
      await this.assertNoReservations(
        room,
        later(dto.to, today),
        range.to,
        'remove availability',
      );
    }
    range.from = dto.from;
    range.to = dto.to;
    await range.save();
    await this.log(user, hotel._id, 'hotel.room.availability.update', room, {
      from: dto.from,
      to: dto.to,
    });
    return this.rangeView(range);
  }

  /** HTL-05: availability cannot be removed for dates with a Confirmed (or Pending Payment) reservation */
  async removeRange(
    user: AuthUser,
    hotelId: string,
    roomId: string,
    rangeId: string,
  ) {
    const hotel = await this.hotels.getManageable(user, hotelId);
    const room = await this.getRoom(hotel._id, roomId);
    const range = await this.getRange(room._id, rangeId);
    const today = todayIn(hotel.timeZone);
    if (range.to > today) {
      await this.assertNoReservations(
        room,
        later(range.from, today),
        range.to,
        'remove availability',
      );
    }
    await this.rangeModel.deleteOne({ _id: range._id }).exec();
    await this.log(user, hotel._id, 'hotel.room.availability.remove', room, {
      from: range.from,
      to: range.to,
    });
    return { removed: true };
  }

  // =====================================================================================
  // Blocked dates (HTL-06)
  // =====================================================================================

  /** Block nights (maintenance ...). Rejected (409) if any of them has a Confirmed or Pending Payment reservation. */
  async createBlock(
    user: AuthUser,
    hotelId: string,
    roomId: string,
    dto: CreateRoomBlockDto,
  ) {
    const hotel = await this.hotels.getManageable(user, hotelId);
    const room = await this.getRoom(hotel._id, roomId);
    const nights = this.checkRange(dto, todayIn(hotel.timeZone));

    const session = await this.connection.startSession();
    let block!: RoomBlockDocument;
    try {
      await session.withTransaction(async () => {
        [block] = await this.blockModel.create(
          [
            {
              room: room._id,
              hotel: hotel._id,
              from: dto.from,
              to: dto.to,
              reason: dto.reason,
              createdBy: new Types.ObjectId(user.id),
            },
          ],
          { session },
        );
        await this.inventory.claim(
          [{ room: room._id, hotel: hotel._id, nights }],
          { kind: RoomNightKind.BLOCK, id: block._id },
          session,
        );
      });
    } finally {
      await session.endSession();
    }
    await this.log(user, hotel._id, 'hotel.room.block', room, {
      from: dto.from,
      to: dto.to,
    });
    return this.blockView(block, room);
  }

  async listBlocks(user: AuthUser, hotelId: string, roomId: string) {
    const hotel = await this.hotels.getManageable(user, hotelId);
    const room = await this.getRoom(hotel._id, roomId);
    const blocks = await this.blockModel
      .find({ room: room._id, to: { $gt: todayIn(hotel.timeZone) } })
      .sort({ from: 1 })
      .exec();
    return blocks.map((b) => this.blockView(b, room));
  }

  async removeBlock(
    user: AuthUser,
    hotelId: string,
    roomId: string,
    blockId: string,
  ) {
    const hotel = await this.hotels.getManageable(user, hotelId);
    const room = await this.getRoom(hotel._id, roomId);
    if (!Types.ObjectId.isValid(blockId))
      throw new BadRequestException('Invalid block id');
    const block = await this.blockModel
      .findOne({ _id: blockId, room: room._id })
      .exec();
    if (!block) throw new NotFoundException('Block not found');

    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        await this.inventory.releaseBlock(block._id, session);
        await this.blockModel.deleteOne({ _id: block._id }, { session }).exec();
      });
    } finally {
      await session.endSession();
    }
    await this.log(user, hotel._id, 'hotel.room.unblock', room, {
      from: block.from,
      to: block.to,
    });
    return { removed: true };
  }

  // =====================================================================================
  // Calendar (HTL-08)
  // =====================================================================================

  /**
   * Night-by-night status of a room: Available, Booked (with the reservation reference) or Blocked.
   * Nights outside every bookable range show as "not_bookable".
   */
  /** GET /api/hotels/:id/availability (HTL-08): the calendar of every room of the hotel */
  async hotelCalendar(user: AuthUser, hotelId: string, q: RoomCalendarQueryDto) {
    const hotel = await this.hotels.getManageable(user, hotelId);
    const rooms = await this.roomModel.find({ hotel: hotel._id }).sort({ roomNumber: 1 }).exec();
    const calendars = [];
    for (const room of rooms) {
      calendars.push(await this.calendar(user, hotelId, room._id.toString(), q));
    }
    return { hotelId: hotel._id.toString(), from: q.from, to: q.to, rooms: calendars };
  }

  async calendar(
    user: AuthUser,
    hotelId: string,
    roomId: string,
    q: RoomCalendarQueryDto,
  ) {
    const hotel = await this.hotels.getManageable(user, hotelId);
    const room = await this.getRoom(hotel._id, roomId);
    const length = nightsBetween(q.from, q.to);
    if (length < 1 || length > 366) {
      throw new BadRequestException(
        'The calendar range must be 1 to 366 nights',
      );
    }
    const [taken, ranges] = await Promise.all([
      this.inventory.nightsOfRoom(room._id, q.from, q.to),
      this.rangeModel
        .find({ room: room._id, from: { $lt: q.to }, to: { $gt: q.from } })
        .lean()
        .exec(),
    ]);
    const bookingIds = [
      ...new Set(
        taken.filter((n) => n.booking).map((n) => n.booking!.toString()),
      ),
    ];
    const bookings = await this.connection
      .collection('hotelbookings')
      .find(
        { _id: { $in: bookingIds.map((id) => new Types.ObjectId(id)) } },
        { projection: { reference: 1, status: 1 } },
      )
      .toArray();
    const refs = new Map(bookings.map((b) => [b._id.toString(), b]));
    const byDate = new Map(taken.map((n) => [n.date, n]));
    const inRange = (d: string) => ranges.some((r) => r.from <= d && d < r.to);

    return {
      room: this.toView(room),
      from: q.from,
      to: q.to,
      nights: nightsOf(q.from, q.to).map((date) => {
        const n = byDate.get(date);
        if (n?.kind === RoomNightKind.BOOKING) {
          const b = refs.get(n.booking!.toString());
          return {
            date,
            status: 'booked',
            reference: b?.reference,
            reservationStatus: b?.status,
            reservationId: n.booking!.toString(),
          };
        }
        if (n?.kind === RoomNightKind.BLOCK) {
          return { date, status: 'blocked', blockId: n.block?.toString() };
        }
        return { date, status: inRange(date) ? 'available' : 'not_bookable' };
      }),
    };
  }

  // =====================================================================================
  // Helpers
  // =====================================================================================

  async getRoom(
    hotelId: Types.ObjectId,
    roomId: string,
  ): Promise<RoomDocument> {
    if (!Types.ObjectId.isValid(roomId))
      throw new BadRequestException('Invalid room id');
    const room = await this.roomModel
      .findOne({ _id: roomId, hotel: hotelId })
      .exec();
    if (!room) throw new NotFoundException('Room not found in this hotel');
    return room;
  }

  toView(r: Room) {
    return {
      id: r._id.toString(),
      hotelId: r.hotel.toString(),
      roomNumber: r.roomNumber,
      type: r.type,
      description: r.description,
      beds: r.beds,
      maxOccupancy: r.maxOccupancy,
      pricePerNight: r.pricePerNight,
      currency: PLATFORM_CURRENCY,
      amenities: r.amenities,
      isActive: r.isActive,
    };
  }

  private async rangesOf(roomId: Types.ObjectId) {
    const ranges = await this.rangeModel
      .find({ room: roomId })
      .sort({ from: 1 })
      .exec();
    return ranges.map((r) => this.rangeView(r));
  }

  private async getRange(roomId: Types.ObjectId, rangeId: string) {
    if (!Types.ObjectId.isValid(rangeId))
      throw new BadRequestException('Invalid availability id');
    const range = await this.rangeModel
      .findOne({ _id: rangeId, room: roomId })
      .exec();
    if (!range) throw new NotFoundException('Availability range not found');
    return range;
  }

  /** Valid, not in the past, and not absurdly long. Returns the nights of the range. */
  private checkRange(dto: DateRangeDto, today: string) {
    return validateRange(dto.from, dto.to, {
      today,
      maxNights: MAX_RANGE_NIGHTS,
      maxDaysAhead: MAX_DAYS_AHEAD,
      label: 'date range',
    });
  }

  private async assertNoOverlappingRange(
    roomId: Types.ObjectId,
    dto: DateRangeDto,
    except?: Types.ObjectId,
  ) {
    const clash = await this.rangeModel
      .findOne({
        room: roomId,
        from: { $lt: dto.to },
        to: { $gt: dto.from },
        ...(except && { _id: { $ne: except } }),
      })
      .exec();
    if (clash) {
      throw new ConflictException(
        `This overlaps the room's bookable range ${clash.from} to ${clash.to}. Ranges cannot overlap; edit that range instead.`,
      );
    }
  }

  /** 409 if the room has a Confirmed or Pending Payment reservation on a night in [from, to) (or from onwards) */
  private async assertNoReservations(
    room: Room,
    from: string,
    to: string | undefined,
    action: string,
  ) {
    const reserved = await this.inventory.reservedNights(room._id, from, to);
    if (reserved.length > 0) {
      throw new ConflictException(
        `Cannot ${action}: room ${room.roomNumber} has a confirmed or pending reservation on ${reserved[0].date}` +
          (reserved.length > 1
            ? ` and ${reserved.length - 1} more night(s)`
            : ''),
      );
    }
  }

  private rangeView(r: RoomRange) {
    return {
      id: r._id.toString(),
      from: r.from,
      to: r.to,
      nights: nightsBetween(r.from, r.to),
    };
  }

  private blockView(b: RoomBlock, room: Room) {
    return {
      id: b._id.toString(),
      roomId: room._id.toString(),
      roomNumber: room.roomNumber,
      from: b.from,
      to: b.to,
      nights: nightsBetween(b.from, b.to),
      reason: b.reason,
      createdAt: b.createdAt,
    };
  }

  private log(
    user: AuthUser,
    hotelId: Types.ObjectId,
    action: string,
    room: Room,
    extra: Record<string, unknown> = {},
  ) {
    return this.audit.log(user, {
      action,
      targetType: 'hotel',
      targetId: hotelId,
      details: {
        roomId: room._id.toString(),
        roomNumber: room.roomNumber,
        ...extra,
      },
    });
  }
}
