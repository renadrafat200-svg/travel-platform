import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';

const DAY_MS = 86_400_000;
/** Longest period one request may cover */
const MAX_RANGE_DAYS = 366;
const round2 = (n: number) => Math.round(n * 100) / 100;

type Row = Record<string, unknown>;

/**
 * Optional bonus: administrator analytics. One dashboard answer with users, bookings,
 * revenue and refunds (from Stripe payments, in USD), top destinations, hotels and airlines,
 * bookings per day, and content/moderation counts. Reads the shared collections directly
 * (read-only), so it needs no changes in the other modules.
 */
@Injectable()
export class AdminAnalyticsService {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async dashboard(query: AnalyticsQueryDto) {
    const { from, to } = this.range(query);
    const inRange = { createdAt: { $gte: from, $lt: to } };
    const col = (name: string) => this.connection.collection(name);
    const count = (name: string, filter: Row = {}) => col(name).countDocuments(filter);
    const group = async (name: string, field: string, filter: Row = {}) => {
      const rows = await col(name)
        .aggregate([{ $match: filter }, { $group: { _id: `$${field}`, n: { $sum: 1 } } }])
        .toArray();
      return Object.fromEntries(rows.map((r) => [String(r._id ?? 'unknown'), r.n as number]));
    };
    const sum = async (name: string, field: string, filter: Row) => {
      const [row] = await col(name)
        .aggregate([{ $match: filter }, { $group: { _id: null, total: { $sum: `$${field}` }, n: { $sum: 1 } } }])
        .toArray();
      return { total: round2((row?.total as number) ?? 0), count: (row?.n as number) ?? 0 };
    };

    const [
      usersTotal, usersByRole, usersByStatus, newUsers, verifiedUsers,
      flightByStatus, hotelByStatus,
      paid, refunded, pendingRefunds,
      topFlightDest, topHotelCities, topHotels, topAirlines,
      perDayFlights, perDayHotels,
      itinerariesTotal, publicItineraries, postsPublished, comments, reviews, openReports, avgRating,
    ] = await Promise.all([
      count('users'),
      group('users', 'role'),
      group('users', 'status'),
      count('users', inRange),
      count('users', { emailVerified: true }),
      group('flightbookings', 'status', inRange),
      group('hotelbookings', 'status', inRange),
      sum('payments', 'amount', { ...inRange, status: { $in: ['succeeded', 'refunded'] } }),
      sum('refunds', 'amount', { ...inRange, status: 'refunded' }),
      sum('refunds', 'amount', { status: 'pending' }),
      this.top('flightbookings', { $arrayElemAt: ['$legs.destination', 0] }, inRange),
      this.top('hotelbookings', '$city', inRange),
      this.top('hotelbookings', '$hotelName', inRange, true),
      this.topAirlines(inRange),
      this.perDay('flightbookings', inRange),
      this.perDay('hotelbookings', inRange),
      count('itineraries'),
      count('itineraries', { isPublic: true, isHidden: { $ne: true } }),
      count('posts', { status: 'published', isHidden: { $ne: true } }),
      count('comments', { isHidden: { $ne: true } }),
      count('reviews', { isHidden: { $ne: true } }),
      count('reports', { status: 'open' }),
      col('reviews').aggregate([{ $match: { isHidden: { $ne: true } } }, { $group: { _id: null, avg: { $avg: '$rating' } } }]).toArray(),
    ]);

    // Bookings per day, every day of the period (zeros included)
    const days: { date: string; flights: number; hotels: number; total: number }[] = [];
    for (let t = from.getTime(); t < to.getTime(); t += DAY_MS) {
      const date = new Date(t).toISOString().slice(0, 10);
      const f = perDayFlights.get(date) ?? 0;
      const h = perDayHotels.get(date) ?? 0;
      days.push({ date, flights: f, hotels: h, total: f + h });
    }
    const totalBookings = (g: Record<string, number>) => Object.values(g).reduce((a, b) => a + b, 0);
    const paidStatuses = (g: Record<string, number>) => (g.confirmed ?? 0) + (g.completed ?? 0);

    return {
      period: { from: from.toISOString().slice(0, 10), to: new Date(to.getTime() - DAY_MS).toISOString().slice(0, 10) },
      currency: 'USD',
      users: {
        total: usersTotal,
        newInPeriod: newUsers,
        emailVerified: verifiedUsers,
        byRole: usersByRole,
        byStatus: usersByStatus,
      },
      bookings: {
        flights: { total: totalBookings(flightByStatus), paid: paidStatuses(flightByStatus), byStatus: flightByStatus },
        hotels: { total: totalBookings(hotelByStatus), paid: paidStatuses(hotelByStatus), byStatus: hotelByStatus },
        cancellationRate: this.rate(
          (flightByStatus.cancelled ?? 0) + (hotelByStatus.cancelled ?? 0),
          paidStatuses(flightByStatus) + paidStatuses(hotelByStatus) + (flightByStatus.cancelled ?? 0) + (hotelByStatus.cancelled ?? 0),
        ),
        perDay: days,
      },
      revenue: {
        payments: paid.count,
        gross: paid.total,
        refunded: refunded.total,
        net: round2(paid.total - refunded.total),
        refundsPending: pendingRefunds.total,
      },
      top: {
        flightDestinations: topFlightDest,
        hotelCities: topHotelCities,
        hotels: topHotels,
        airlines: topAirlines,
      },
      content: {
        itineraries: itinerariesTotal,
        publicItineraries,
        publishedPosts: postsPublished,
        comments,
        reviews,
        averageReviewRating: avgRating[0]?.avg ? round2(avgRating[0].avg as number) : null,
        openReports,
      },
      generatedAt: new Date(),
    };
  }

  /** Top 5 values of one field among bookings, by number of bookings (and paid amount) */
  private async top(name: string, key: unknown, match: Row, withRevenue = false) {
    const rows = await this.connection
      .collection(name)
      .aggregate([
        { $match: match },
        {
          $group: {
            _id: key,
            bookings: { $sum: 1 },
            revenue: {
              $sum: { $cond: [{ $in: ['$status', ['confirmed', 'completed']] }, '$totalAmount', 0] },
            },
          },
        },
        { $sort: { bookings: -1, _id: 1 } },
        { $limit: 5 },
      ])
      .toArray();
    return rows.map((r) => ({
      name: String(r._id ?? 'unknown'),
      bookings: r.bookings as number,
      ...(withRevenue && { revenue: round2(r.revenue as number) }),
    }));
  }

  private async topAirlines(match: Row) {
    const rows = await this.connection
      .collection('flightbookings')
      .aggregate([
        { $match: match },
        { $group: { _id: { $arrayElemAt: ['$legs.airline', 0] }, bookings: { $sum: 1 } } },
        { $sort: { bookings: -1 } },
        { $limit: 5 },
        { $lookup: { from: 'airlines', localField: '_id', foreignField: '_id', as: 'airline' } },
      ])
      .toArray();
    return rows.map((r) => {
      const a = (r.airline as Row[])[0];
      return { name: (a?.name as string) ?? 'Unknown', iataCode: (a?.iataCode as string) ?? null, bookings: r.bookings as number };
    });
  }

  private async perDay(name: string, match: Row): Promise<Map<string, number>> {
    const rows = await this.connection
      .collection(name)
      .aggregate([
        { $match: match },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, n: { $sum: 1 } } },
      ])
      .toArray();
    return new Map(rows.map((r) => [r._id as string, r.n as number]));
  }

  private rate(part: number, whole: number) {
    return whole ? round2((part / whole) * 100) : 0;
  }

  /** [from 00:00 UTC, the day after `to` 00:00 UTC) */
  private range(q: AnalyticsQueryDto) {
    const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
    const to = q.to ? new Date(q.to.slice(0, 10) + 'T00:00:00Z') : today;
    const from = q.from ? new Date(q.from.slice(0, 10) + 'T00:00:00Z') : new Date(today.getTime() - 29 * DAY_MS);
    if (from > to) throw new BadRequestException('"from" must not be after "to"');
    if ((to.getTime() - from.getTime()) / DAY_MS > MAX_RANGE_DAYS) {
      throw new BadRequestException(`The period can be at most ${MAX_RANGE_DAYS} days`);
    }
    return { from, to: new Date(to.getTime() + DAY_MS) };
  }
}
