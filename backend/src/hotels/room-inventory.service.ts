import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { RoomNight, RoomNightKind } from './schemas/room-night.schema';
import { RoomRange } from './schemas/room-range.schema';
import { addDays } from './stay-dates.util';

export interface NightClaim {
  room: Types.ObjectId;
  hotel: Types.ObjectId;
  nights: string[];
}

const isDuplicateKey = (err: unknown) =>
  !!err &&
  typeof err === 'object' &&
  ((err as { code?: number }).code === 11000 ||
    ((err as { writeErrors?: { code?: number }[] }).writeErrors ?? []).some(
      (e) => e.code === 11000,
    ));

/**
 * The only place that marks room nights as taken or free, and that answers
 * "can this room be booked on these nights?".
 *
 * A night of a room is bookable when:
 *   1. it lies inside one of the room's bookable ranges (HTL-04), and
 *   2. no RoomNight exists for it (no confirmed reservation, unexpired hold or block).
 *
 * Concurrency safety (HTL-18): a night is taken by inserting a RoomNight document, and the
 * unique index on (room, date) lets only ONE document exist per room per night. Two
 * overlapping reservations always share a night, so the second insert fails. Callers run
 * this inside a MongoDB transaction, so a reservation for several rooms takes all of its
 * nights or none: one taken night rolls back the whole request.
 */
@Injectable()
export class RoomInventoryService {
  constructor(
    @InjectModel(RoomNight.name) private readonly nightModel: Model<RoomNight>,
    @InjectModel(RoomRange.name) private readonly rangeModel: Model<RoomRange>,
  ) {}

  /** Takes every night of every room, or throws 409 (the caller's transaction then takes nothing) */
  async claim(
    claims: NightClaim[],
    owner: { kind: RoomNightKind; id: Types.ObjectId },
    session: ClientSession,
  ): Promise<void> {
    const docs = claims.flatMap((c) =>
      c.nights.map((date) => ({
        room: c.room,
        hotel: c.hotel,
        date,
        kind: owner.kind,
        ...(owner.kind === RoomNightKind.BOOKING
          ? { booking: owner.id }
          : { block: owner.id }),
      })),
    );
    try {
      await this.nightModel.insertMany(docs, { session, ordered: true });
    } catch (err) {
      if (isDuplicateKey(err)) {
        throw new ConflictException(
          owner.kind === RoomNightKind.BOOKING
            ? 'One of the rooms is no longer free on these dates (reserved, on hold or blocked). Nothing was reserved.'
            : 'The room has a confirmed or pending reservation, or another block, on some of these nights',
        );
      }
      throw err;
    }
  }

  async releaseBooking(bookingId: Types.ObjectId, session?: ClientSession) {
    await this.nightModel
      .deleteMany({ booking: bookingId }, { session })
      .exec();
  }

  async releaseBlock(blockId: Types.ObjectId, session?: ClientSession) {
    await this.nightModel.deleteMany({ block: blockId }, { session }).exec();
  }

  /**
   * Of the given rooms, the ones that can be booked for ALL these nights:
   * every night inside a bookable range, and no night taken.
   */
  async freeRooms(
    roomIds: Types.ObjectId[],
    nights: string[],
  ): Promise<Set<string>> {
    if (roomIds.length === 0 || nights.length === 0) return new Set();
    const covered = await this.coveredRooms(roomIds, nights);
    const candidates = roomIds.filter((id) => covered.has(id.toString()));
    if (candidates.length === 0) return new Set();
    const taken = await this.nightModel
      .distinct('room', {
        room: { $in: candidates },
        date: { $gte: nights[0], $lte: nights.at(-1)! },
      })
      .exec();
    const takenSet = new Set(
      (taken as Types.ObjectId[]).map((id) => id.toString()),
    );
    return new Set(
      candidates.map((id) => id.toString()).filter((id) => !takenSet.has(id)),
    );
  }

  /** Rooms whose bookable ranges cover every night from nights[0] to nights.at(-1) */
  async coveredRooms(
    roomIds: Types.ObjectId[],
    nights: string[],
  ): Promise<Set<string>> {
    const first = nights[0];
    const end = addDays(nights.at(-1)!, 1); // exclusive
    const ranges = await this.rangeModel
      .find({ room: { $in: roomIds }, from: { $lt: end }, to: { $gt: first } })
      .sort({ from: 1 })
      .lean()
      .exec();
    const byRoom = new Map<string, { from: string; to: string }[]>();
    for (const r of ranges) {
      const k = r.room.toString();
      byRoom.set(k, [...(byRoom.get(k) ?? []), r]);
    }
    const covered = new Set<string>();
    for (const [room, list] of byRoom) {
      // walk the sorted ranges; touching ranges (one's "to" = next "from") join up
      let reach = first;
      for (const r of list) {
        if (r.from > reach) break;
        if (r.to > reach) reach = r.to;
        if (reach >= end) break;
      }
      if (reach >= end) covered.add(room);
    }
    return covered;
  }

  /** Taken nights of one room in [from, toExclusive), for the calendar */
  async nightsOfRoom(
    roomId: Types.ObjectId,
    from: string,
    toExclusive: string,
  ) {
    return this.nightModel
      .find({ room: roomId, date: { $gte: from, $lt: toExclusive } })
      .sort({ date: 1 })
      .lean()
      .exec();
  }

  /** Reserved nights (confirmed or pending holds) of a room in [from, toExclusive); omit toExclusive for "from onwards" */
  async reservedNights(
    roomId: Types.ObjectId,
    from: string,
    toExclusive?: string,
  ) {
    return this.nightModel
      .find({
        room: roomId,
        kind: RoomNightKind.BOOKING,
        date: { $gte: from, ...(toExclusive && { $lt: toExclusive }) },
      })
      .sort({ date: 1 })
      .lean()
      .exec();
  }

  async deleteAllOfRoom(roomId: Types.ObjectId, session: ClientSession) {
    await this.nightModel.deleteMany({ room: roomId }, { session }).exec();
    await this.rangeModel.deleteMany({ room: roomId }, { session }).exec();
  }
}
