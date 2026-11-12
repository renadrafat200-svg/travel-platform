/**
 * Proves the seat hold is concurrency-safe on the real database (FLT-22).
 *   cd backend
 *   node scripts/check-seat-race.js
 * Makes a throw-away flight with 5 seats in a scratch collection, fires 20 hold requests at the
 * same moment using exactly the update SeatInventoryService uses, checks that exactly 5 succeed
 * and the seat count ends at 0, then deletes the scratch data.
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

(async () => {
    const { MONGODB_URI } = readEnv();
    await mongoose.connect(MONGODB_URI);
    const flights = mongoose.connection.collection('zz_seat_race_check');

    const cabinId = new mongoose.Types.ObjectId();
    const { insertedId } = await flights.insertOne({
        status: 'scheduled',
        departureTime: new Date(Date.now() + 7 * 24 * 3600e3),
        cabins: [
            { _id: new mongoose.Types.ObjectId(), cabinClass: 'business', availableSeats: 2 },
            { _id: cabinId, cabinClass: 'economy', availableSeats: 5 },
        ],
    });

    // Same filter and update as SeatInventoryService.take()
    const takeOneSeat = () =>
        flights.updateOne(
            {
                _id: insertedId,
                status: 'scheduled',
                departureTime: { $gt: new Date() },
                cabins: { $elemMatch: { _id: cabinId, availableSeats: { $gte: 1 } } },
            },
            { $inc: { 'cabins.$.availableSeats': -1 } },
        );

    const results = await Promise.all(Array.from({ length: 20 }, takeOneSeat));
    const won = results.filter((r) => r.modifiedCount === 1).length;
    const doc = await flights.findOne({ _id: insertedId });
    const economy = doc.cabins.find((c) => c._id.equals(cabinId)).availableSeats;
    const business = doc.cabins.find((c) => !c._id.equals(cabinId)).availableSeats;

    await flights.drop();
    await mongoose.disconnect();

    console.log(`20 people tried at once for 5 seats: ${won} got a seat.`);
    console.log(`Economy seats left: ${economy}. Business seats left (untouched): ${business}.`);
    const passed = won === 5 && economy === 0 && business === 2;
    console.log(passed ? 'PASS: no overbooking.' : 'FAIL: send this output to the team.');
    process.exit(passed ? 0 : 1);
})().catch((err) => {
    console.error(err);
    process.exit(1);
});