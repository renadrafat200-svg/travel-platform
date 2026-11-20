import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import { FlightBooking } from '../flight-bookings/schemas/flight-booking.schema';
import { HotelBooking } from '../hotel-bookings/schemas/hotel-booking.schema';
import { User } from '../users/schemas/user.schema';
import { AttachBookingDto } from './dto/itinerary-extras.dto';
import { ItinerariesService } from './itineraries.service';
import { buildItineraryPdf } from './itinerary.pdf';
import { dayDate, toDateString } from './itinerary.constants';
import { ItineraryItemsService } from './itinerary-items.service';
import { ItineraryDocument } from './schemas/itinerary.schema';

/** A booking may be attached once it is paid (confirmed), or after the trip (completed) */
const ATTACHABLE = ['confirmed', 'completed'];
/** At most this many bookings on one itinerary */
const MAX_ATTACHED = 30;

export interface AttachedBookingView {
  id: string;
  bookingType: 'flight' | 'hotel';
  bookingId: string;
  attachedAt: Date;
  /** null if the booking no longer exists */
  booking: {
    reference: string;
    status: string;
    title: string;
    startDate: string;
    endDate: string;
    totalAmount: number;
    currency: string;
  } | null;
  /** Day numbers of the itinerary whose dates fall in the booking */
  dayNumbers: number[];
}

/**
 * Optional bonuses on itineraries:
 *  - ITN-27: attach my confirmed flight and hotel bookings to my itinerary
 *  - ITN-28: export an itinerary as a PDF
 */
@Injectable()
export class ItineraryExtrasService {
  constructor(
    @InjectModel(FlightBooking.name) private readonly flightBookingModel: Model<FlightBooking>,
    @InjectModel(HotelBooking.name) private readonly hotelBookingModel: Model<HotelBooking>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly itineraries: ItinerariesService,
    private readonly items: ItineraryItemsService,
    private readonly exchangeRates: ExchangeRatesService,
  ) {}

  // =====================================================================================
  // ITN-27: attached bookings
  // =====================================================================================

  /** GET /api/itineraries/:id: my itinerary, now with its attached bookings */
  async findMineWithBookings(user: AuthUser, id: string) {
    const itinerary = await this.itineraries.getOwned(user, id);
    return {
      ...(await this.itineraries.toDetail(itinerary)),
      bookings: await this.bookingsView(itinerary),
    };
  }

  /** POST /api/itineraries/:id/bookings */
  async attach(user: AuthUser, id: string, dto: AttachBookingDto) {
    const itinerary = await this.itineraries.getOwned(user, id);
    const booking = await this.loadBooking(dto.bookingType, dto.bookingId);
    // Only the itinerary owner's own bookings (an admin acting on someone's itinerary uses the owner's)
    if (!booking || booking.user.toString() !== itinerary.owner.toString()) {
      throw new NotFoundException('Booking not found among your bookings');
    }
    if (!ATTACHABLE.includes(booking.status)) {
      throw new BadRequestException(
        `Only confirmed bookings can be attached; this booking is ${booking.status}`,
      );
    }
    if (itinerary.attachedBookings.some((a) => a.booking.equals(booking._id))) {
      throw new ConflictException('This booking is already attached to this itinerary');
    }
    if (itinerary.attachedBookings.length >= MAX_ATTACHED) {
      throw new BadRequestException(`At most ${MAX_ATTACHED} bookings per itinerary`);
    }
    itinerary.attachedBookings.push({
      bookingType: dto.bookingType,
      booking: booking._id,
      attachedAt: new Date(),
    } as never);
    await this.itineraries.save(itinerary);
    return this.findMineWithBookings(user, id);
  }

  /** GET /api/itineraries/:id/bookings */
  async list(user: AuthUser, id: string) {
    const itinerary = await this.itineraries.getOwned(user, id);
    return { itineraryId: itinerary._id.toString(), items: await this.bookingsView(itinerary) };
  }

  /** DELETE /api/itineraries/:id/bookings/:attachmentId (the booking itself is not touched) */
  async detach(user: AuthUser, id: string, attachmentId: string) {
    const itinerary = await this.itineraries.getOwned(user, id);
    const found = itinerary.attachedBookings.find(
      (a) => a._id.toString() === attachmentId || a.booking.toString() === attachmentId,
    );
    if (!found) throw new NotFoundException('That booking is not attached to this itinerary');
    itinerary.attachedBookings.pull(found._id);
    await this.itineraries.save(itinerary);
    return this.findMineWithBookings(user, id);
  }

  /** The attached bookings with their CURRENT status and the itinerary days they cover */
  async bookingsView(itinerary: ItineraryDocument): Promise<AttachedBookingView[]> {
    const attached = itinerary.attachedBookings ?? [];
    if (!attached.length) return [];
    const ids = (type: string) => attached.filter((a) => a.bookingType === type).map((a) => a.booking);
    const [flights, hotels] = await Promise.all([
      this.flightBookingModel.find({ _id: { $in: ids('flight') } }).lean().exec(),
      this.hotelBookingModel.find({ _id: { $in: ids('hotel') } }).lean().exec(),
    ]);
    const byId = new Map<string, AttachedBookingView['booking']>();
    for (const f of flights) {
      const first = f.legs[0];
      const last = f.legs[f.legs.length - 1];
      byId.set(f._id.toString(), {
        reference: f.reference,
        status: f.status,
        title: f.legs.map((l) => `${l.flightNumber} ${l.origin}-${l.destination}`).join(', '),
        startDate: toDateString(first.departureTime),
        endDate: toDateString(last.departureTime),
        totalAmount: f.totalAmount,
        currency: f.currency,
      });
    }
    for (const h of hotels) {
      byId.set(h._id.toString(), {
        reference: h.reference,
        status: h.status,
        title: `${h.hotelName} (${h.nights} night${h.nights === 1 ? '' : 's'})`,
        startDate: h.checkInDate,
        endDate: h.checkOutDate,
        totalAmount: h.totalAmount,
        currency: h.currency,
      });
    }
    const dates = itinerary.days.map((_, i) => dayDate(itinerary.startDate, i));
    return attached.map((a) => {
      const booking = byId.get(a.booking.toString()) ?? null;
      let dayNumbers: number[] = [];
      if (booking) {
        dayNumbers = dates
          .map((d, i) => ({ d, n: i + 1 }))
          .filter(({ d }) =>
            a.bookingType === 'hotel'
              ? d >= booking.startDate && d < booking.endDate // nights stayed
              : d === booking.startDate || d === booking.endDate, // flight days
          )
          .map(({ n }) => n);
      }
      return {
        id: a._id.toString(),
        bookingType: a.bookingType,
        bookingId: a.booking.toString(),
        attachedAt: a.attachedAt,
        booking,
        dayNumbers,
      };
    });
  }

  private loadBooking(type: 'flight' | 'hotel', id: string) {
    if (!Types.ObjectId.isValid(id)) return null;
    return type === 'flight'
      ? this.flightBookingModel.findById(id, { user: 1, status: 1 }).lean().exec()
      : this.hotelBookingModel.findById(id, { user: 1, status: 1 }).lean().exec();
  }

  // =====================================================================================
  // ITN-28: PDF export
  // =====================================================================================

  /**
   * GET /api/itineraries/:id/pdf: the owner (or an admin) can export any of their itineraries;
   * anyone can export a public, not hidden one. Attached bookings are only in the owner's copy.
   */
  async pdf(viewer: AuthUser | undefined, id: string, currency?: string) {
    const itinerary = await this.itineraries.findById(id);
    const isOwner = this.itineraries.isOwnerOrAdmin(viewer, itinerary);
    if (!isOwner && !(itinerary.isPublic && !itinerary.isHidden)) {
      throw new NotFoundException('Itinerary not found');
    }
    const display = currency
      ? await this.exchangeRates.assertSupported(currency)
      : await this.itineraries.preferredCurrency(viewer?.id);
    const detail = await this.itineraries.toDetail(itinerary, display);
    // Budget by category; if no exchange rates exist at all, the PDF still comes out without it
    let summary: Awaited<ReturnType<ItineraryItemsService['summarize']>> | null = null;
    try {
      summary = await this.items.summarize(itinerary, display);
    } catch {
      summary = null;
    }
    const author = await this.userModel
      .findById(itinerary.owner, { firstName: 1, lastName: 1 })
      .lean()
      .exec();
    const file = await buildItineraryPdf({
      detail,
      summary,
      authorName: author ? `${author.firstName} ${author.lastName}`.trim() : 'Unknown',
      bookings: isOwner ? await this.bookingsView(itinerary) : [],
      generatedAt: new Date(),
    });
    const slug = itinerary.title.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'itinerary';
    return { file, fileName: `${slug}.pdf` };
  }
}
