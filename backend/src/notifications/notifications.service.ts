import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, QueryFilter, Types } from 'mongoose';
import { paginate } from '../common/dto/pagination-query.dto';
import { NotificationsQueryDto } from './dto/notifications-query.dto';
import { Notification, NotificationDocument, NotificationType } from './schemas/notification.schema';

type Id = string | Types.ObjectId;

/**
 * GEN-01: in-app notifications. NotificationsModule is @Global, so any service can inject it:
 *   constructor(private readonly notifications: NotificationsService) {}
 *   await this.notifications.notify(booking.user, NotificationType.BOOKING_CONFIRMED,
 *     'Booking confirmed', `Your booking ${ref} is confirmed.`, { bookingType: 'flight', bookingId });
 * A failure here is logged but never breaks the action that triggered it.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectModel(Notification.name) private readonly notificationModel: Model<Notification>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async notify(
    userId: Id,
    type: NotificationType,
    title: string,
    message: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.notificationModel.create({
        user: new Types.ObjectId(userId.toString()),
        type,
        title,
        message,
        data,
      });
    } catch (err) {
      this.logger.error(`Could not send ${type} notification to ${userId.toString()}`, err as Error);
    }
  }

  /** Same notification to several users (e.g. every passenger of a rescheduled flight). Duplicates are sent once. */
  async notifyMany(
    userIds: Id[],
    type: NotificationType,
    title: string,
    message: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    const unique = [...new Set(userIds.map((id) => id.toString()))];
    if (unique.length === 0) return;
    try {
      await this.notificationModel.insertMany(
        unique.map((id) => ({ user: new Types.ObjectId(id), type, title, message, data })),
      );
    } catch (err) {
      this.logger.error(`Could not send ${type} notifications`, err as Error);
    }
  }

  /**
   * FLT-05 / FLT-06: everyone holding a CONFIRMED booking on this flight.
   * Reads the flightbookings collection directly so FlightsModule does not need to import
   * FlightBookingsModule (which already imports FlightsModule).
   */
  async notifyFlightPassengers(
    flightId: Id,
    type: NotificationType,
    title: string,
    message: string,
    data?: Record<string, unknown>,
  ): Promise<number> {
    try {
      const bookings = await this.connection
        .collection('flightbookings')
        .find(
          { 'legs.flight': new Types.ObjectId(flightId.toString()), status: 'confirmed' },
          { projection: { user: 1 } },
        )
        .toArray();
      const users = bookings.map((b) => b.user as Types.ObjectId);
      await this.notifyMany(users, type, title, message, { flightId: flightId.toString(), ...data });
      return new Set(users.map((u) => u.toString())).size;
    } catch (err) {
      this.logger.error(`Could not notify passengers of flight ${flightId.toString()}`, err as Error);
      return 0;
    }
  }

  /**
   * ACC-15: an airline or hotel was deactivated / reactivated. Notifies its moderators and every
   * user with an upcoming confirmed booking with that provider.
   */
  async notifyProviderChange(
    providerType: 'airline' | 'hotel',
    providerId: Id,
    type: NotificationType,
    title: string,
    message: string,
  ): Promise<void> {
    try {
      const id = new Types.ObjectId(providerId.toString());
      const now = new Date();
      const [moderators, bookings] = await Promise.all([
        this.connection
          .collection('users')
          .find({ providerType, providerId: id }, { projection: { _id: 1 } })
          .toArray(),
        providerType === 'airline'
          ? this.connection
              .collection('flightbookings')
              .find(
                { 'legs.airline': id, status: 'confirmed', 'legs.departureTime': { $gt: now } },
                { projection: { user: 1 } },
              )
              .toArray()
          : this.connection
              .collection('hotelbookings')
              .find({ hotel: id, status: 'confirmed', checkOut: { $gt: now } }, { projection: { user: 1 } })
              .toArray(),
      ]);
      const users = [
        ...moderators.map((m) => m._id as Types.ObjectId),
        ...bookings.map((b) => b.user as Types.ObjectId),
      ];
      await this.notifyMany(users, type, title, message, { providerType, providerId: id.toString() });
    } catch (err) {
      this.logger.error(`Could not notify about ${providerType} ${providerId.toString()}`, err as Error);
    }
  }

  /** GET /api/notifications: the user's own notifications, newest first */
  async findMine(userId: string, query: NotificationsQueryDto) {
    const filter: QueryFilter<Notification> = { user: new Types.ObjectId(userId) };
    if (query.unreadOnly) filter.readAt = null;
    const [docs, total] = await Promise.all([
      this.notificationModel
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(query.skip)
        .limit(query.limit)
        .exec(),
      this.notificationModel.countDocuments(filter).exec(),
    ]);
    return paginate(
      docs.map((d) => this.toView(d)),
      total,
      query,
    );
  }

  async unreadCount(userId: string) {
    const unread = await this.notificationModel
      .countDocuments({ user: new Types.ObjectId(userId), readAt: null })
      .exec();
    return { unread };
  }

  async markRead(userId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid notification id');
    // Filtering on the user too means another user's notification simply looks "not found"
    const doc = await this.notificationModel
      .findOne({ _id: new Types.ObjectId(id), user: new Types.ObjectId(userId) })
      .exec();
    if (!doc) throw new NotFoundException('Notification not found');
    if (!doc.readAt) {
      doc.readAt = new Date();
      await doc.save();
    }
    return this.toView(doc);
  }

  async markAllRead(userId: string) {
    const res = await this.notificationModel
      .updateMany({ user: new Types.ObjectId(userId), readAt: null }, { $set: { readAt: new Date() } })
      .exec();
    return { marked: res.modifiedCount };
  }

  private toView(n: NotificationDocument) {
    return {
      id: n._id.toString(),
      type: n.type,
      title: n.title,
      message: n.message,
      data: n.data,
      read: !!n.readAt,
      readAt: n.readAt,
      createdAt: n.createdAt,
    };
  }
}
