/**
 * Proves hotel booking is concurrency-safe and all-or-nothing on the real database (Member 4).
 *   cd backend
 *   node scripts/check-room-race.js
 * Uses throw-away collections. Fires 20 bookings for overlapping dates on the same room at the
 * same moment, each one in a transaction exactly like HotelBookingsService.create(), and checks:
 *   1. exactly 1 succeeds, and the room has exactly that booking's nights
 *   2. a 2-room booking where only the second room is taken leaves NOTHING behind
 * then deletes the scratch data.
 */
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

function readEnv() {
  const file = path.join(__dirname, '..', '.env');
  const env = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return env;
}

const nightsOf = (start, count) =>
  Array.from({ length: count }, (_, i) => {
    const d = new Date(`${start}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });

(async () => {
  const { MONGODB_URI } = readEnv();
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db;
  const nights = db.collection('zz_room_race_nights');
  const bookings = db.collection('zz_room_race_bookings');
  await nights.createIndex({ room: 1, date: 1 }, { unique: true });

  // Same steps as HotelBookingsService.create(): save the booking, take every night, in one transaction
  async function book(roomIds, firstNight, count) {
    const session = mongoose.connection.getClient().startSession();
    try {
      await session.withTransaction(async () => {
        const bookingId = new mongoose.Types.ObjectId();
        await bookings.insertOne(
          { _id: bookingId, rooms: roomIds },
          { session },
        );
        const docs = roomIds.flatMap((room) =>
          nightsOf(firstNight, count).map((date) => ({
            room,
            date,
            booking: bookingId,
          })),
        );
        await nights.insertMany(docs, { session, ordered: true });
      });
      return 'ok';
    } catch (err) {
      if (err.code === 11000 || err.writeErrors?.some((e) => e.code === 11000))
        return 'taken';
      throw err;
    } finally {
      await session.endSession();
    }
  }

  let failed = false;
  try {
    // 1. 20 people, overlapping 3-night stays (starting 1st, 2nd or 3rd) on the same room
    const room = new mongoose.Types.ObjectId();
    const starts = ['2030-01-01', '2030-01-02', '2030-01-03'];
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => book([room], starts[i % 3], 3)),
    );
    const ok = results.filter((r) => r === 'ok').length;
    const taken = await nights.countDocuments({ room });
    console.log(
      `Race: ${ok} of 20 bookings succeeded, room has ${taken} taken nights`,
    );
    if (ok !== 1 || taken !== 3) failed = true;

    // 2. Two rooms: A is free, B is already taken -> the whole booking must fail and keep nothing
    const roomA = new mongoose.Types.ObjectId();
    const roomB = new mongoose.Types.ObjectId();
    await book([roomB], '2030-02-01', 1);
    const res = await book([roomA, roomB], '2030-02-01', 2);
    const keptA = await nights.countDocuments({ room: roomA });
    const left = await bookings.countDocuments({ rooms: roomA });
    console.log(
      `All-or-nothing: result=${res}, nights kept on the free room=${keptA}, bookings left=${left}`,
    );
    if (res !== 'taken' || keptA !== 0 || left !== 0) failed = true;
  } finally {
    await nights.drop().catch(() => {});
    await bookings.drop().catch(() => {});
    await mongoose.disconnect();
  }
  console.log(
    failed
      ? 'FAIL'
      : 'PASS: no double booking, and multi-room bookings are all-or-nothing',
  );
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
