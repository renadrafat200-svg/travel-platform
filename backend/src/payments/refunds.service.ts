import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model, QueryFilter, Types } from 'mongoose';
import Stripe from 'stripe';
import { PaginationQueryDto, paginate } from '../common/dto/pagination-query.dto';
import { AuthUser } from '../common/interfaces/auth-user.interface';
import { assertOwnerOrAdmin } from '../common/utils/ownership';
import { PLATFORM_CURRENCY } from '../config/platform.constants';
import { FlightBookingsService } from '../flight-bookings/flight-bookings.service';
import {
  BookingStatus,
  FlightBooking,
  RefundStatus,
} from '../flight-bookings/schemas/flight-booking.schema';
import { HotelBookingsService } from '../hotel-bookings/hotel-bookings.service';
import {
  HotelBooking,
  HotelBookingStatus,
  HotelRefundStatus,
} from '../hotel-bookings/schemas/hotel-booking.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/schemas/notification.schema';
import { Payment, PaymentDocument, PaymentStatus } from './schemas/payment.schema';
import { BookingType } from './schemas/policy-acceptance.schema';
import { Refund, RefundDocument, RefundRecordStatus } from './schemas/refund.schema';
import { StripeService, toCents } from './stripe.service';

interface RefundableBooking {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  reference: string;
  status: string;
  cancelledBy?: string;
  refundAmount?: number;
  refundStatus: string;
  paymentReference?: string;
}

/**
 * PAY-03: refunds through the Stripe Refunds API.
 * The booking modules set refundStatus "pending" + refundAmount when a paid booking is cancelled
 * (user: the provider's tiers; airline/hotel: 100%). This service picks those up (right away via
 * refundBooking(), and every 30 seconds as a safety net), refunds on Stripe, records a Refund and
 * moves the booking to refunded / failed. Stripe's refund webhooks finish refunds that start pending.
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    @InjectModel(Refund.name) private readonly refundModel: Model<Refund>,
    @InjectModel(Payment.name) private readonly paymentModel: Model<Payment>,
    @InjectModel(FlightBooking.name) private readonly flightBookingModel: Model<FlightBooking>,
    @InjectModel(HotelBooking.name) private readonly hotelBookingModel: Model<HotelBooking>,
    private readonly stripeService: StripeService,
    private readonly flightBookings: FlightBookingsService,
    private readonly hotelBookings: HotelBookingsService,
    private readonly notifications: NotificationsService,
  ) {}

  // =====================================================================================
  // Refunding cancelled bookings
  // =====================================================================================

  /**
   * Refunds one cancelled booking (refundStatus "pending", refundAmount > 0). Safe to call twice:
   * a payment is refunded at most once. Returns the Refund, or null if there is nothing to refund.
   */
  async refundBooking(type: BookingType, bookingId: string | Types.ObjectId) {
    const booking = await this.loadBooking(type, bookingId);
    if (!booking || booking.status !== 'cancelled' || booking.refundStatus !== 'pending') return null;
    const amount = booking.refundAmount ?? 0;
    if (amount <= 0) return null;
    if (!booking.paymentReference) {
      this.logger.warn(`${type} booking ${booking.reference} needs a refund but has no payment reference`);
      return null;
    }
    const payment = await this.paymentModel.findOne({ stripePaymentId: booking.paymentReference }).exec();
    if (!payment) {
      this.logger.warn(`No payment ${booking.paymentReference} found for ${type} booking ${booking.reference}`);
      return null;
    }
    const reason = booking.cancelledBy === 'user' || booking.cancelledBy === 'admin'
      ? 'user_cancellation'
      : 'provider_cancellation';
    return this.issue(payment, Math.min(amount, payment.amount), reason, booking.reference);
  }

  /** PAY-01: paid after the hold expired (or paid twice): the whole payment goes back */
  async refundLatePayment(payment: PaymentDocument) {
    const refund = await this.issue(payment, payment.amount, 'hold_expired');
    payment.status = PaymentStatus.REFUNDED;
    await payment.save();
    return refund;
  }

  /** Safety net: refunds every cancelled booking still waiting for its refund */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async refundPendingCancellations(): Promise<number> {
    if (!this.stripeService.isConfigured) return 0;
    const common = { refundAmount: { $gt: 0 }, paymentReference: { $exists: true, $ne: null } };
    const flightFilter: QueryFilter<FlightBooking> = {
      ...common,
      status: BookingStatus.CANCELLED,
      refundStatus: RefundStatus.PENDING,
    };
    const hotelFilter: QueryFilter<HotelBooking> = {
      ...common,
      status: HotelBookingStatus.CANCELLED,
      refundStatus: HotelRefundStatus.PENDING,
    };
    const [flights, hotels] = await Promise.all([
      this.flightBookingModel.find(flightFilter, { _id: 1 }).limit(100).lean().exec(),
      this.hotelBookingModel.find(hotelFilter, { _id: 1 }).limit(100).lean().exec(),
    ]);
    let count = 0;
    for (const [type, list] of [
      [BookingType.FLIGHT, flights],
      [BookingType.HOTEL, hotels],
    ] as const) {
      for (const { _id } of list) {
        try {
          if (await this.refundBooking(type, _id)) count++;
        } catch (err) {
          this.logger.error(`Refund of ${type} booking ${_id.toString()} failed`, err as Error);
        }
      }
    }
    if (count) this.logger.log(`Issued ${count} refund(s)`);
    return count;
  }

  // =====================================================================================
  // Stripe refund webhooks: refund.updated, refund.failed, charge.refunded
  // =====================================================================================

  async handleEvent(event: Stripe.Event): Promise<boolean> {
    switch (event.type) {
      case 'refund.created':
      case 'refund.updated':
      case 'refund.failed':
        await this.syncFromStripe(event.data.object);
        return true;
      case 'charge.refunded':
        for (const r of event.data.object.refunds?.data ?? []) await this.syncFromStripe(r);
        return true;
      default:
        return false;
    }
  }

  // =====================================================================================
  // Viewing
  // =====================================================================================

  /** GET /api/refunds/:id (owner or admin) */
  async findOne(user: AuthUser, id: string) {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid refund id');
    const refund = await this.refundModel.findById(id).exec();
    if (!refund) throw new NotFoundException('Refund not found');
    assertOwnerOrAdmin(user, refund.user);
    return this.toView(refund);
  }

  /** GET /api/refunds: my refunds, newest first */
  async findMine(user: AuthUser, query: PaginationQueryDto) {
    const filter = { user: new Types.ObjectId(user.id) };
    const [docs, total] = await Promise.all([
      this.refundModel.find(filter).sort({ createdAt: -1 }).skip(query.skip).limit(query.limit).exec(),
      this.refundModel.countDocuments(filter).exec(),
    ]);
    return paginate(
      docs.map((r) => this.toView(r)),
      total,
      query,
    );
  }

  // =====================================================================================
  // Helpers
  // =====================================================================================

  private async issue(payment: PaymentDocument, amount: number, reason: string, reference?: string) {
    // Claim the payment first: the unique index on "payment" makes double refunds impossible
    let refund: RefundDocument;
    try {
      refund = await this.refundModel.create({
        user: payment.user,
        bookingType: payment.bookingType,
        booking: payment.booking,
        payment: payment._id,
        amount,
        currency: PLATFORM_CURRENCY,
        status: RefundRecordStatus.PENDING,
        reason,
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        return this.refundModel.findOne({ payment: payment._id }).exec(); // already refunded
      }
      throw err;
    }

    try {
      const stripeRefund = await this.stripeService.stripe.refunds.create(
        {
          payment_intent: payment.stripePaymentId,
          amount: toCents(amount),
          metadata: {
            refundId: refund._id.toString(),
            bookingType: payment.bookingType,
            bookingId: payment.booking.toString(),
            reason,
          },
        },
        { idempotencyKey: `refund-${payment._id.toString()}` },
      );
      refund.stripeRefundId = stripeRefund.id;
      await refund.save();
      await this.notifications.notify(
        refund.user,
        NotificationType.REFUND_ISSUED,
        'Refund issued',
        `A refund of ${amount} ${PLATFORM_CURRENCY}${reference ? ` for booking ${reference}` : ''} was sent to your card.`,
        this.data(refund, reference),
      );
      await this.applyStatus(refund, this.statusOf(stripeRefund), reference);
    } catch (err) {
      this.logger.error(`Stripe refund for payment ${payment.stripePaymentId} failed`, err as Error);
      await this.applyStatus(refund, RefundRecordStatus.FAILED, reference);
    }
    return refund;
  }

  private async syncFromStripe(stripeRefund: Stripe.Refund) {
    let refund = await this.refundModel.findOne({ stripeRefundId: stripeRefund.id }).exec();
    // The webhook can arrive before refund.save() stored the id: fall back to our metadata
    const ownId = stripeRefund.metadata?.refundId;
    if (!refund && ownId && Types.ObjectId.isValid(ownId)) {
      refund = await this.refundModel.findById(ownId).exec();
      if (refund && !refund.stripeRefundId) {
        refund.stripeRefundId = stripeRefund.id;
        await refund.save();
      }
    }
    if (!refund) return; // a refund made outside the platform (e.g. in the Stripe dashboard)
    await this.applyStatus(refund, this.statusOf(stripeRefund));
  }

  /** Moves the Refund (and the booking) to its new status once, and tells the user */
  private async applyStatus(refund: RefundDocument, status: RefundRecordStatus, reference?: string) {
    if (status === RefundRecordStatus.PENDING) return;
    const changed = await this.refundModel
      .findOneAndUpdate(
        { _id: refund._id, status: { $ne: status } },
        { $set: { status } },
        { returnDocument: 'after' },
      )
      .exec();
    if (!changed) return;
    refund.status = status;

    const failed = status === RefundRecordStatus.FAILED;
    const bookingId = refund.booking.toString();
    if (refund.reason !== 'hold_expired') {
      if (refund.bookingType === BookingType.FLIGHT) {
        await this.flightBookings.markRefunded(bookingId, refund.stripeRefundId, failed);
      } else {
        await this.hotelBookings.markRefunded(bookingId, refund.stripeRefundId, failed);
      }
    }
    const ref = reference ?? (await this.loadBooking(refund.bookingType, refund.booking))?.reference;
    await this.notifications.notify(
      refund.user,
      failed ? NotificationType.REFUND_FAILED : NotificationType.REFUND_REFUNDED,
      failed ? 'Refund failed' : 'Refund completed',
      failed
        ? `We could not refund ${refund.amount} ${refund.currency}${ref ? ` for booking ${ref}` : ''}. Please contact support.`
        : `Your refund of ${refund.amount} ${refund.currency}${ref ? ` for booking ${ref}` : ''} is complete.`,
      this.data(refund, ref),
    );
  }

  private statusOf(r: Stripe.Refund): RefundRecordStatus {
    if (r.status === 'succeeded') return RefundRecordStatus.REFUNDED;
    if (r.status === 'failed' || r.status === 'canceled') return RefundRecordStatus.FAILED;
    return RefundRecordStatus.PENDING;
  }

  private async loadBooking(type: BookingType, id: string | Types.ObjectId): Promise<RefundableBooking | null> {
    const model = (type === BookingType.FLIGHT ? this.flightBookingModel : this.hotelBookingModel) as Model<
      FlightBooking | HotelBooking
    >;
    return model
      .findById(id, {
        user: 1,
        reference: 1,
        status: 1,
        cancelledBy: 1,
        refundAmount: 1,
        refundStatus: 1,
        paymentReference: 1,
      })
      .lean<RefundableBooking>()
      .exec();
  }

  private data(refund: RefundDocument, reference?: string) {
    return {
      bookingType: refund.bookingType,
      bookingId: refund.booking.toString(),
      refundId: refund._id.toString(),
      ...(reference && { reference }),
    };
  }

  private toView(r: RefundDocument) {
    return {
      id: r._id.toString(),
      bookingType: r.bookingType,
      bookingId: r.booking.toString(),
      paymentId: r.payment.toString(),
      stripeRefundId: r.stripeRefundId,
      amount: r.amount,
      currency: r.currency,
      status: r.status,
      reason: r.reason,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }
}

