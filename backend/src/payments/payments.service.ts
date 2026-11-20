import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model, Types } from 'mongoose';
import Stripe from 'stripe';
import { AuthUser } from '../common/interfaces/auth-user.interface';
import { assertOwnerOrAdmin } from '../common/utils/ownership';
import { PLATFORM_CURRENCY } from '../config/platform.constants';
import { FlightBookingsService } from '../flight-bookings/flight-bookings.service';
import { HotelBookingsService } from '../hotel-bookings/hotel-bookings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/schemas/notification.schema';
import { CreatePaymentDto, RetryPaymentDto } from './dto/payment.dto';
import { Payment, PaymentDocument, PaymentStatus } from './schemas/payment.schema';
import { BookingType } from './schemas/policy-acceptance.schema';
import { PoliciesService } from './policies.service';
import { RefundsService } from './refunds.service';
import { StripeService, toCents } from './stripe.service';

/** Seconds of hold that must be left to start a payment (the card form needs a moment) */
const MIN_SECONDS_LEFT = 15;

interface Chargeable {
  bookingType: 'flight' | 'hotel';
  bookingId: string;
  reference: string;
  amount: number;
  currency: string;
  holdExpiresAt: Date;
}

/**
 * PAY-01: Stripe PaymentIntents in test mode.
 * - POST /api/payments creates a PaymentIntent and returns its clientSecret for Stripe Elements.
 * - The booking is confirmed ONLY when the signed webhook says payment_intent.succeeded.
 * - Failed cards can be retried while the hold lasts; when the hold expires the PaymentIntent is cancelled.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectModel(Payment.name) private readonly paymentModel: Model<Payment>,
    private readonly stripeService: StripeService,
    private readonly policies: PoliciesService,
    private readonly flightBookings: FlightBookingsService,
    private readonly hotelBookings: HotelBookingsService,
    private readonly notifications: NotificationsService,
    private readonly refunds: RefundsService,
  ) {}

  // =====================================================================================
  // Starting a payment
  // =====================================================================================

  /** POST /api/payments */
  async create(user: AuthUser, dto: CreatePaymentDto) {
    const chargeable = await this.getChargeable(user, dto.bookingType, dto.bookingId);
    await this.policies.assertAccepted(user.id, dto.bookingType, dto.bookingId);
    await this.assertNotPaid(dto.bookingType, dto.bookingId);

    // An attempt that is still open is reused instead of charging twice
    const open = await this.paymentModel
      .findOne({
        bookingType: dto.bookingType,
        booking: new Types.ObjectId(dto.bookingId),
        status: PaymentStatus.PENDING,
      })
      .sort({ createdAt: -1 })
      .exec();
    if (open) {
      const intent = await this.retrieveOrForget(open);
      if (intent && this.isOpen(intent) && intent.amount === toCents(chargeable.amount)) {
        return this.startView(open, intent, dto.testPaymentMethod);
      }
      if (intent) await this.cancelIntent(open, PaymentStatus.CANCELLED);
    }
    return this.newAttempt(user, chargeable, dto.testPaymentMethod);
  }

  /** POST /api/payments/:id/retry: a new attempt for the same booking while the hold lasts */
  async retry(user: AuthUser, id: string, dto: RetryPaymentDto) {
    const previous = await this.getOwnedPayment(user, id);
    if (previous.status === PaymentStatus.SUCCEEDED || previous.status === PaymentStatus.REFUNDED) {
      throw new ConflictException(`This payment already ${previous.status}; nothing to retry`);
    }
    const chargeable = await this.getChargeable(user, previous.bookingType, previous.booking.toString());
    await this.policies.assertAccepted(user.id, previous.bookingType, previous.booking.toString());
    await this.assertNotPaid(previous.bookingType, previous.booking.toString());

    // Close every other open attempt for this booking so only one can be paid
    const open = await this.paymentModel
      .find({
        bookingType: previous.bookingType,
        booking: previous.booking,
        status: PaymentStatus.PENDING,
      })
      .exec();
    for (const p of open) await this.cancelIntent(p, PaymentStatus.CANCELLED);

    return this.newAttempt(user, chargeable, dto.testPaymentMethod);
  }

  /** GET /api/payments/:id (owner or admin). Also refreshes the status from Stripe. */
  async findOne(user: AuthUser, id: string) {
    const payment = await this.getOwnedPayment(user, id);
    let lastError: string | undefined;
    try {
      const intent = await this.stripeService.stripe.paymentIntents.retrieve(payment.stripePaymentId);
      lastError = intent.last_payment_error?.message;
      const status = this.statusOf(intent);
      if (status !== payment.status && payment.status !== PaymentStatus.REFUNDED) {
        payment.status = status;
        await payment.save();
      }
    } catch (err) {
      this.logger.warn(`Could not refresh ${payment.stripePaymentId} from Stripe: ${(err as Error).message}`);
    }
    return { ...this.toView(payment), lastError };
  }

  // =====================================================================================
  // Webhook (POST /api/payments/webhook)
  // =====================================================================================

  async handleWebhook(rawBody: Buffer | undefined, signature: string | undefined) {
    if (!rawBody || !signature) throw new BadRequestException('Missing Stripe signature or body');
    let event: Stripe.Event;
    try {
      event = this.stripeService.constructEvent(rawBody, signature);
    } catch (err) {
      if (err instanceof HttpException) throw err; // webhook secret not configured
      throw new BadRequestException(`Webhook signature check failed: ${(err as Error).message}`);
    }

    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.onSucceeded(event.data.object);
        break;
      case 'payment_intent.payment_failed':
        await this.onFailed(event.data.object);
        break;
      case 'payment_intent.canceled':
        await this.paymentModel
          .updateOne(
            { stripePaymentId: event.data.object.id, status: { $in: [PaymentStatus.PENDING, PaymentStatus.FAILED] } },
            { $set: { status: PaymentStatus.CANCELLED } },
          )
          .exec();
        break;
      default:
        // PAY-03: refund.created / refund.updated / refund.failed / charge.refunded
        await this.refunds.handleEvent(event);
    }
    return { received: true, type: event.type };
  }

  /** PAY-03: refund a cancelled booking now (the refunds job also does this every 30 seconds) */
  refundBooking(type: BookingType, bookingId: string) {
    return this.refunds.refundBooking(type, bookingId);
  }

  private async onSucceeded(intent: Stripe.PaymentIntent) {
    const payment = await this.paymentModel.findOne({ stripePaymentId: intent.id }).exec();
    if (!payment) {
      this.logger.warn(`payment_intent.succeeded for unknown PaymentIntent ${intent.id}`);
      return;
    }
    if (payment.status === PaymentStatus.REFUNDED) return; // already handled (webhook retried)
    payment.status = PaymentStatus.SUCCEEDED;
    await payment.save();

    try {
      // Verified by Stripe: now (and only now) the booking is confirmed
      if (payment.bookingType === BookingType.FLIGHT) {
        await this.flightBookings.confirm(payment.booking.toString(), intent.id);
      } else {
        await this.hotelBookings.confirm(payment.booking.toString(), intent.id);
      }
    } catch (err) {
      if (!(err instanceof ConflictException) && !(err instanceof NotFoundException)) throw err;
      // The hold expired (or the booking is gone) before the money arrived: give it back
      this.logger.warn(`Booking ${payment.booking.toString()} could not be confirmed; refunding ${intent.id}`);
      await this.refundLatePayment(payment, (err as Error).message);
    }
  }

  private async onFailed(intent: Stripe.PaymentIntent) {
    const payment = await this.paymentModel
      .findOneAndUpdate(
        { stripePaymentId: intent.id, status: PaymentStatus.PENDING },
        { $set: { status: PaymentStatus.FAILED } },
        { returnDocument: 'after' },
      )
      .exec();
    if (!payment) return; // already failed (and notified) when the card was declined
    await this.notifyFailed(payment, intent.last_payment_error?.message);
  }

  /** GEN-01: tell the user their payment did not go through */
  private notifyFailed(payment: PaymentDocument, reason?: string) {
    return this.notifications.notify(
      payment.user,
      NotificationType.PAYMENT_FAILED,
      'Payment failed',
      `Your payment of ${payment.amount} ${payment.currency} did not go through` +
        (reason ? `: ${reason}` : '.') +
        ' You can try again before the hold expires.',
      { bookingType: payment.bookingType, bookingId: payment.booking.toString(), paymentId: payment._id.toString() },
    );
  }

  /** Paid after the hold expired: the booking cannot be confirmed, so the whole amount goes back */
  private async refundLatePayment(payment: PaymentDocument, reason: string): Promise<void> {
    await this.refunds.refundLatePayment(payment); // records a Refund and notifies "Refund issued"
    await this.notifications.notify(
      payment.user,
      NotificationType.REFUND_ISSUED,
      'Payment refunded',
      `Your payment of ${payment.amount} ${payment.currency} could not be applied to the booking (${reason}). ` +
        'It was refunded in full.',
      { bookingType: payment.bookingType, bookingId: payment.booking.toString(), paymentId: payment._id.toString() },
    );
  }

  // =====================================================================================
  // Hold expiry: cancel open PaymentIntents (every minute)
  // =====================================================================================

  @Cron(CronExpression.EVERY_MINUTE)
  async cancelExpiredAttempts(): Promise<number> {
    if (!this.stripeService.isConfigured) return 0;
    const due = await this.paymentModel
      .find({
        status: { $in: [PaymentStatus.PENDING, PaymentStatus.FAILED] },
        holdExpiresAt: { $lte: new Date() },
      })
      .limit(200)
      .exec();
    let count = 0;
    for (const p of due) {
      try {
        if (await this.cancelIntent(p, PaymentStatus.CANCELLED)) count++;
      } catch (err) {
        this.logger.error(`Could not cancel ${p.stripePaymentId}`, err as Error);
      }
    }
    if (count) this.logger.log(`Cancelled ${count} payment attempt(s) whose hold expired`);
    return count;
  }

  // =====================================================================================
  // Helpers
  // =====================================================================================

  private async newAttempt(user: AuthUser, c: Chargeable, testPaymentMethod?: string) {
    if (testPaymentMethod && !this.stripeService.isTestMode) {
      throw new BadRequestException('testPaymentMethod only works with a Stripe test key (sk_test_...)');
    }
    const stripe = this.stripeService.stripe;
    const intent = await this.stripeService.call(() => stripe.paymentIntents.create({
      amount: toCents(c.amount),
      currency: PLATFORM_CURRENCY.toLowerCase(),
      description: `${c.bookingType === 'flight' ? 'Flight booking' : 'Hotel reservation'} ${c.reference}`,
      metadata: { bookingType: c.bookingType, bookingId: c.bookingId, userId: user.id, reference: c.reference },
      // Cards only, no redirects: works with Stripe Elements and with the Swagger test cards
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
    }));
    const payment = await this.paymentModel.create({
      user: new Types.ObjectId(user.id),
      bookingType: c.bookingType as BookingType,
      booking: new Types.ObjectId(c.bookingId),
      stripePaymentId: intent.id,
      amount: c.amount,
      currency: PLATFORM_CURRENCY,
      status: PaymentStatus.PENDING,
      holdExpiresAt: c.holdExpiresAt,
    });
    return this.startView(payment, intent, testPaymentMethod);
  }

  /** Optionally pays with a Stripe test card (Swagger testing), then returns what the frontend needs */
  private async startView(payment: PaymentDocument, intent: Stripe.PaymentIntent, testPaymentMethod?: string) {
    let lastError: string | undefined;
    if (testPaymentMethod) {
      if (!this.stripeService.isTestMode) {
        throw new BadRequestException('testPaymentMethod only works with a Stripe test key (sk_test_...)');
      }
      try {
        intent = await this.stripeService.stripe.paymentIntents.confirm(intent.id, {
          payment_method: testPaymentMethod,
        });
      } catch (err) {
        // A declined card: Stripe returns the updated PaymentIntent inside the error
        const e = err as { raw?: { payment_intent?: Stripe.PaymentIntent }; message?: string };
        lastError = e.message;
        if (e.raw?.payment_intent) intent = e.raw.payment_intent;
        else intent = await this.stripeService.stripe.paymentIntents.retrieve(intent.id);
      }
      // Only the status is updated here. The booking is confirmed by the webhook, never here.
      const status = this.statusOf(intent);
      if (status !== payment.status) {
        const wasPending = payment.status === PaymentStatus.PENDING;
        payment.status = status;
        await payment.save();
        // GEN-01: a declined card. The later payment_failed webhook will not notify again.
        if (wasPending && status === PaymentStatus.FAILED) {
          await this.notifyFailed(payment, intent.last_payment_error?.message ?? lastError);
        }
      }
    }
    return {
      paymentId: payment._id.toString(),
      clientSecret: intent.client_secret,
      stripePaymentId: payment.stripePaymentId,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      holdExpiresAt: payment.holdExpiresAt,
      ...(lastError && { lastError }),
      note:
        payment.status === PaymentStatus.SUCCEEDED
          ? 'Payment succeeded. The booking is confirmed as soon as the Stripe webhook arrives.'
          : undefined,
    };
  }

  /** Cancels the PaymentIntent on Stripe if it can still be cancelled. Returns true if the record changed. */
  private async cancelIntent(payment: PaymentDocument, status: PaymentStatus): Promise<boolean> {
    const stripe = this.stripeService.stripe;
    let intent = await this.retrieveOrForget(payment);
    if (!intent) return true; // unknown to this Stripe account: already marked cancelled
    if (this.isOpen(intent)) {
      try {
        intent = await stripe.paymentIntents.cancel(intent.id);
      } catch {
        intent = await stripe.paymentIntents.retrieve(payment.stripePaymentId); // paid at the last second
      }
    }
    // If it succeeded meanwhile, the webhook handles it (confirm, or refund if the hold expired)
    const next = intent.status === 'canceled' ? status : this.statusOf(intent);
    const res = await this.paymentModel
      .updateOne({ _id: payment._id, status: payment.status }, { $set: { status: next } })
      .exec();
    payment.status = next;
    return res.modifiedCount > 0;
  }

  /**
   * Looks up the payment's PaymentIntent on Stripe. The team shares one database but each laptop
   * can use its own Stripe test account, so a payment made on another laptop is unknown here
   * ("No such payment_intent"). Such a payment can never be completed from this account, so it is
   * marked cancelled once (instead of failing every minute) and null is returned.
   */
  private async retrieveOrForget(payment: PaymentDocument): Promise<Stripe.PaymentIntent | null> {
    try {
      return await this.stripeService.stripe.paymentIntents.retrieve(payment.stripePaymentId);
    } catch (err) {
      if ((err as { code?: string }).code !== 'resource_missing') throw err;
      this.logger.warn(
        `PaymentIntent ${payment.stripePaymentId} does not exist in this Stripe account; marking the payment cancelled`,
      );
      await this.paymentModel
        .updateOne({ _id: payment._id }, { $set: { status: PaymentStatus.CANCELLED } })
        .exec();
      payment.status = PaymentStatus.CANCELLED;
      return null;
    }
  }

  private isOpen(intent: Stripe.PaymentIntent) {
    return ['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(intent.status);
  }

  private statusOf(intent: Stripe.PaymentIntent): PaymentStatus {
    switch (intent.status) {
      case 'succeeded':
        return PaymentStatus.SUCCEEDED;
      case 'canceled':
        return PaymentStatus.CANCELLED;
      case 'requires_payment_method':
        return intent.last_payment_error ? PaymentStatus.FAILED : PaymentStatus.PENDING;
      default:
        return PaymentStatus.PENDING;
    }
  }

  private async getChargeable(user: AuthUser, type: BookingType, id: string): Promise<Chargeable> {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid booking id');
    const c =
      type === BookingType.FLIGHT
        ? await this.flightBookings.getForPayment(user, id)
        : await this.hotelBookings.getForPayment(user, id);
    const secondsLeft = (new Date(c.holdExpiresAt).getTime() - Date.now()) / 1000;
    if (secondsLeft < MIN_SECONDS_LEFT) {
      throw new BadRequestException('The hold on this booking has (almost) expired. Book again.');
    }
    // PAY-04: one platform currency, no conversion
    if (c.currency.toUpperCase() !== PLATFORM_CURRENCY) {
      throw new BadRequestException(`Bookings are paid in ${PLATFORM_CURRENCY}; this one is in ${c.currency}`);
    }
    if (!(c.amount > 0)) throw new BadRequestException('Nothing to pay for this booking');
    return { ...c, holdExpiresAt: new Date(c.holdExpiresAt) };
  }

  private async assertNotPaid(type: BookingType, bookingId: string) {
    const paid = await this.paymentModel.exists({
      bookingType: type,
      booking: new Types.ObjectId(bookingId),
      status: PaymentStatus.SUCCEEDED,
    });
    if (paid) {
      throw new ConflictException('This booking is already paid; it is confirmed when Stripe notifies us');
    }
  }

  private async getOwnedPayment(user: AuthUser, id: string): Promise<PaymentDocument> {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid payment id');
    const payment = await this.paymentModel.findById(id).exec();
    if (!payment) throw new NotFoundException('Payment not found');
    assertOwnerOrAdmin(user, payment.user);
    return payment;
  }

  private toView(p: PaymentDocument) {
    return {
      id: p._id.toString(),
      bookingType: p.bookingType,
      bookingId: p.booking.toString(),
      stripePaymentId: p.stripePaymentId,
      amount: p.amount,
      currency: p.currency,
      status: p.status,
      holdExpiresAt: p.holdExpiresAt,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }
}
