import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Airline } from '../airlines/schemas/airline.schema';
import { AuthUser } from '../common/interfaces/auth-user.interface';
import { assertOwnerOrAdmin } from '../common/utils/ownership';
import { FlightBooking } from '../flight-bookings/schemas/flight-booking.schema';
import { HotelBooking } from '../hotel-bookings/schemas/hotel-booking.schema';
import { Hotel } from '../hotels/schemas/hotel.schema';
import { BookingType, PolicyAcceptance } from './schemas/policy-acceptance.schema';

/**
 * PAY-02: before paying, the user sees the provider's policies and must accept them.
 *   flight -> each airline's cancellation and baggage policies
 *   hotel  -> the cancellation tiers saved on the reservation + check-in / check-out times
 */
@Injectable()
export class PoliciesService {
  constructor(
    @InjectModel(FlightBooking.name) private readonly flightBookingModel: Model<FlightBooking>,
    @InjectModel(HotelBooking.name) private readonly hotelBookingModel: Model<HotelBooking>,
    @InjectModel(Airline.name) private readonly airlineModel: Model<Airline>,
    @InjectModel(Hotel.name) private readonly hotelModel: Model<Hotel>,
    @InjectModel(PolicyAcceptance.name) private readonly acceptanceModel: Model<PolicyAcceptance>,
  ) {}

  /** GET /api/bookings/:type/:id/policies */
  async getPolicies(user: AuthUser, type: BookingType, id: string) {
    const { booking, policies } = await this.load(user, type, id);
    const acceptance = await this.findAcceptance(booking.user, type, id);
    return {
      bookingType: type,
      bookingId: id,
      reference: booking.reference,
      status: booking.status,
      ...policies,
      accepted: !!acceptance,
      acceptedAt: acceptance?.acceptedAt ?? null,
    };
  }

  /** POST /api/bookings/:type/:id/accept-policies: only the owner, only before payment */
  async accept(user: AuthUser, type: BookingType, id: string) {
    const { booking, policies } = await this.load(user, type, id);
    if (!booking.user.equals(user.id)) {
      throw new ForbiddenException('Only the person who made the booking can accept its policies');
    }
    if (booking.status !== 'pending') {
      throw new BadRequestException(`This booking is ${booking.status}; policies are accepted before payment`);
    }
    if (booking.holdExpiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('The hold on this booking expired. Book again.');
    }
    // Accepting twice keeps the first timestamp
    const acceptance = await this.acceptanceModel
      .findOneAndUpdate(
        { user: booking.user, bookingType: type, booking: new Types.ObjectId(id) },
        { $setOnInsert: { acceptedAt: new Date(), policies } },
        { upsert: true, returnDocument: 'after' },
      )
      .exec();
    return {
      message: 'Policies accepted. You can now pay.',
      bookingType: type,
      bookingId: id,
      accepted: true,
      acceptedAt: acceptance.acceptedAt,
    };
  }

  /** Used by PaymentsService: 400 until the policies were accepted */
  async assertAccepted(userId: string | Types.ObjectId, type: BookingType, bookingId: string) {
    const acceptance = await this.findAcceptance(userId, type, bookingId);
    if (!acceptance) {
      throw new BadRequestException(
        `Accept the provider's policies first: POST /api/bookings/${type}/${bookingId}/accept-policies`,
      );
    }
    return acceptance;
  }

  private findAcceptance(userId: string | Types.ObjectId, type: BookingType, bookingId: string) {
    return this.acceptanceModel
      .findOne({
        user: new Types.ObjectId(userId.toString()),
        bookingType: type,
        booking: new Types.ObjectId(bookingId),
      })
      .lean()
      .exec();
  }

  private async load(user: AuthUser, type: BookingType, id: string) {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid booking id');
    return type === BookingType.FLIGHT ? this.loadFlight(user, id) : this.loadHotel(user, id);
  }

  private async loadFlight(user: AuthUser, id: string) {
    const booking = await this.flightBookingModel.findById(id).exec();
    if (!booking) throw new NotFoundException('Booking not found');
    assertOwnerOrAdmin(user, booking.user);

    const airlineIds = [...new Set(booking.legs.map((l) => l.airline.toString()))];
    const airlines = await this.airlineModel
      .find(
        { _id: { $in: airlineIds } },
        { name: 1, iataCode: 1, baggagePolicy: 1, cancellationPolicy: 1 },
      )
      .lean()
      .exec();
    const policies = {
      provider: 'airline',
      flights: booking.legs.map((l) => ({
        flightNumber: l.flightNumber,
        route: `${l.origin}-${l.destination}`,
        airlineId: l.airline.toString(),
      })),
      airlines: airlines.map((a) => ({
        airlineId: a._id.toString(),
        name: a.name,
        iataCode: a.iataCode,
        cancellationPolicy: {
          rules: (a.cancellationPolicy?.rules ?? []).map((r) => ({
            hoursBeforeDeparture: r.hoursBeforeDeparture,
            refundPercent: r.refundPercent,
          })),
          notes: a.cancellationPolicy?.notes,
        },
        baggagePolicy: a.baggagePolicy,
      })),
    };
    return { booking, policies };
  }

  private async loadHotel(user: AuthUser, id: string) {
    const booking = await this.hotelBookingModel.findById(id).exec();
    if (!booking) throw new NotFoundException('Reservation not found');
    assertOwnerOrAdmin(user, booking.user);

    const hotel = await this.hotelModel
      .findById(booking.hotel, { name: 1, policies: 1 })
      .lean()
      .exec();
    const policies = {
      provider: 'hotel',
      hotelId: booking.hotel.toString(),
      hotelName: booking.hotelName,
      // The tiers saved on the reservation are the ones that apply to it
      cancellationPolicy: {
        tiers: booking.cancellationTiers.map((t) => ({
          daysBeforeCheckIn: t.daysBeforeCheckIn,
          refundPercent: t.refundPercent,
        })),
      },
      checkInTime: hotel?.policies?.checkInTime,
      checkOutTime: hotel?.policies?.checkOutTime,
      notes: hotel?.policies?.notes,
      checkInDate: booking.checkInDate,
      checkOutDate: booking.checkOutDate,
    };
    return { booking, policies };
  }
}
