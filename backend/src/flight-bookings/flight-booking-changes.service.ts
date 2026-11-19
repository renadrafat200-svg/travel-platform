import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AirlinesService } from '../airlines/airlines.service';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/schemas/notification.schema';
import { Flight, FlightDocument, FlightStatus } from '../flights/schemas/flight.schema';
import { ChangeFlightDto, SelectSeatDto } from './dto/flight-booking.dto';
import { FlightBookingsService } from './flight-bookings.service';
import {
    BookingStatus,
    FlightBooking,
    FlightBookingDocument,
    PassengerType,
} from './schemas/flight-booking.schema';
import { SeatAssignment } from './schemas/seat-assignment.schema';
import { SeatInventoryService } from './seat-inventory.service';
import { seatMap } from './seat-map';

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Optional bonuses on flight bookings:
 *  - FLT-28: choose a seat for each passenger on each flight
 *  - FLT-27: move a paid booking to another flight of the same airline on the same route
 */
@Injectable()
export class FlightBookingChangesService {
    constructor(
        @InjectModel(FlightBooking.name) private readonly bookingModel: Model<FlightBooking>,
        @InjectModel(Flight.name) private readonly flightModel: Model<Flight>,
        @InjectModel(SeatAssignment.name) private readonly seatModel: Model<SeatAssignment>,
        private readonly bookings: FlightBookingsService,
        private readonly inventory: SeatInventoryService,
        private readonly airlines: AirlinesService,
        private readonly notifications: NotificationsService,
    ) { }

    // =====================================================================================
    // FLT-28: seat selection
    // =====================================================================================

    /** GET /api/flight-bookings/:id/seats: for each flight, the seats of my cabin, which are free, and mine */
    async seatsView(user: AuthUser, id: string) {
        const booking = await this.bookings.getOwned(user, id);
        const legs = [];
        for (const leg of booking.legs) {
            const flight = await this.flightModel.findById(leg.flight).exec();
            const labels = flight ? (seatMap(flight.cabins).get(leg.cabinClass) ?? []) : [];
            const taken = await this.seatModel.find({ flight: leg.flight }).lean().exec();
            const mine = taken.filter((t) => t.booking.equals(booking._id));
            const takenSet = new Set(taken.map((t) => t.seat));
            legs.push({
                flightId: leg.flight.toString(),
                flightNumber: leg.flightNumber,
                route: `${leg.origin}-${leg.destination}`,
                cabinClass: leg.cabinClass,
                seats: labels.map((seat) => ({ seat, free: !takenSet.has(seat) })),
                freeSeats: labels.filter((s) => !takenSet.has(s)).length,
                myPassengers: booking.passengers.map((p, i) => ({
                    passenger: i + 1,
                    name: `${p.firstName} ${p.lastName}`,
                    type: p.type,
                    seat: mine.find((m) => m.passengerIndex === i)?.seat ?? null,
                    needsSeat: p.type !== PassengerType.INFANT,
                })),
            });
        }
        return { bookingId: booking._id.toString(), reference: booking.reference, flights: legs };
    }

    /** PATCH /api/flight-bookings/:id/seat: choose (or change) one passenger's seat on one flight */
    async selectSeat(user: AuthUser, id: string, dto: SelectSeatDto) {
        const booking = await this.bookings.getOwned(user, id);
        const isPaid = booking.status === BookingStatus.CONFIRMED;
        const isHeldWithDetails = booking.status === BookingStatus.PENDING && booking.passengers.length > 0;
        if (!isPaid && !isHeldWithDetails) {
            throw new BadRequestException(
                booking.status === BookingStatus.PENDING
                    ? 'Add the passenger details first, then choose seats'
                    : `Seats cannot be chosen for a ${booking.status} booking`,
            );
        }
        const leg = booking.legs.find((l) => l.flight.toString() === dto.flightId);
        if (!leg) throw new NotFoundException('That flight is not part of this booking');
        const index = dto.passenger - 1;
        const passenger = booking.passengers[index];
        if (!passenger) {
            throw new BadRequestException(`passenger must be between 1 and ${booking.passengers.length}`);
        }
        if (passenger.type === PassengerType.INFANT) {
            throw new BadRequestException('Infants travel on an adult’s lap and have no seat');
        }
        const flight = await this.flightModel.findById(leg.flight).exec();
        if (!flight || flight.status !== FlightStatus.SCHEDULED || flight.departureTime <= new Date()) {
            throw new BadRequestException('Seats can only be chosen before the flight departs');
        }
        const seat = dto.seat.toUpperCase();
        const labels = seatMap(flight.cabins).get(leg.cabinClass) ?? [];
        if (!labels.includes(seat)) {
            throw new BadRequestException(
                `Seat ${seat} is not in the ${leg.cabinClass} cabin of this flight (${labels[0]}-${labels[labels.length - 1]})`,
            );
        }

        const previous = await this.seatModel
            .findOne({ flight: leg.flight, booking: booking._id, passengerIndex: index })
            .exec();
        if (previous?.seat === seat) return this.seatsView(user, id);
        if (previous) await previous.deleteOne();
        try {
            // The unique index (flight, seat) rejects a seat someone else already has
            await this.seatModel.create({ flight: leg.flight, seat, booking: booking._id, passengerIndex: index });
        } catch (err) {
            if (previous) {
                await this.seatModel
                    .create({ flight: leg.flight, seat: previous.seat, booking: booking._id, passengerIndex: index })
                    .catch(() => undefined);
            }
            if ((err as { code?: number }).code === 11000) {
                throw new ConflictException(`Seat ${seat} is already taken. Pick another one.`);
            }
            throw err;
        }
        return this.seatsView(user, id);
    }

    // =====================================================================================
    // FLT-27: change flight
    // =====================================================================================

    /**
     * PATCH /api/flight-bookings/:id/change-flight
     * A paid booking moves one of its flights to another flight with:
     *  - the same airline, origin and destination, and the same cabin class
     *  - a fare for the same passengers that is not higher than the fare paid
     *    (the price paid stays the same; a more expensive flight needs cancel + rebook)
     *  - free seats, departing in the future (and, for a round trip, still in order)
     * Seats move atomically; chosen seat numbers on the old flight are released; e-ticket numbers stay.
     */
    async changeFlight(user: AuthUser, id: string, dto: ChangeFlightDto) {
        const booking = await this.bookings.getOwned(user, id);
        if (booking.status !== BookingStatus.CONFIRMED) {
            throw new BadRequestException(`Only confirmed (paid) bookings can be changed; this one is ${booking.status}`);
        }
        const legIndex = booking.legs.findIndex((l) => l.flight.toString() === dto.currentFlightId);
        if (legIndex === -1) throw new NotFoundException('That flight is not part of this booking');
        if (dto.newFlightId === dto.currentFlightId) {
            throw new BadRequestException('Pick a different flight');
        }
        const leg = booking.legs[legIndex];
        const now = new Date();

        const current = await this.flightModel.findById(leg.flight).exec();
        if ((current?.departureTime ?? leg.departureTime) <= now) {
            throw new BadRequestException(`Flight ${leg.flightNumber} has already departed and cannot be changed`);
        }
        const next = await this.getNewFlight(dto.newFlightId, now);
        if (!next.airline.equals(leg.airline)) {
            throw new BadRequestException('The new flight must be operated by the same airline');
        }
        if (next.origin !== leg.origin || next.destination !== leg.destination) {
            throw new BadRequestException(`The new flight must fly the same route (${leg.origin}-${leg.destination})`);
        }
        if (booking.legs.some((l) => l.flight.equals(next._id))) {
            throw new BadRequestException('This booking already includes that flight');
        }
        const cabin = next.cabins.find((c) => c.cabinClass === leg.cabinClass);
        if (!cabin) {
            throw new BadRequestException(`Flight ${next.flightNumber} has no ${leg.cabinClass} cabin`);
        }
        await this.assertRoundTripOrder(booking, legIndex, next);

        // Same passengers, same cabin: the new fare must not be higher than the fare paid
        const newFare = round2(booking.passengers.reduce((sum, p) => sum + cabin.prices[p.type], 0));
        if (newFare > leg.fareAmount) {
            throw new BadRequestException(
                `Flight ${next.flightNumber} costs ${round2(newFare - leg.fareAmount)} ${booking.currency} more. ` +
                    'Only flights with the same or a lower fare can be changed to; otherwise cancel and book again.',
            );
        }

        // Move the seats: take on the new flight first (atomic), then give back the old ones
        await this.inventory.takeAll([
            { flightId: next._id, cabinId: cabin._id, seats: leg.seats, departsAfter: now },
        ]);
        const updated = await this.bookingModel
            .findOneAndUpdate(
                { _id: booking._id, status: BookingStatus.CONFIRMED, [`legs.${legIndex}.flight`]: leg.flight },
                {
                    $set: {
                        [`legs.${legIndex}.flight`]: next._id,
                        [`legs.${legIndex}.cabinId`]: cabin._id,
                        [`legs.${legIndex}.flightNumber`]: next.flightNumber,
                        [`legs.${legIndex}.departureTime`]: next.departureTime,
                    },
                    $push: {
                        changes: {
                            changedAt: now,
                            legIndex,
                            fromFlight: leg.flight,
                            fromFlightNumber: leg.flightNumber,
                            fromDeparture: current?.departureTime ?? leg.departureTime,
                            toFlight: next._id,
                            toFlightNumber: next.flightNumber,
                            toDeparture: next.departureTime,
                        },
                    },
                },
                { returnDocument: 'after' },
            )
            .exec();
        if (!updated) {
            await this.inventory.release(next._id, cabin._id, leg.seats);
            throw new ConflictException('This booking changed meanwhile; please reload it');
        }
        await this.inventory.release(leg.flight, leg.cabinId, leg.seats);
        await this.seatModel.deleteMany({ booking: booking._id, flight: leg.flight }).exec();

        await this.notifications.notify(
            updated.user,
            NotificationType.BOOKING_CHANGED,
            'Flight booking changed',
            `Booking ${updated.reference}: flight ${leg.flightNumber} was changed to ${next.flightNumber} ` +
                `departing ${next.departureTime.toISOString().slice(0, 16).replace('T', ' ')} UTC. Your e-ticket is updated.`,
            { bookingType: 'flight', bookingId: updated._id.toString(), reference: updated.reference },
        );
        return this.bookings.toView(updated);
    }

    private async getNewFlight(id: string, now: Date): Promise<FlightDocument> {
        const flight = await this.flightModel.findById(id).exec();
        if (!flight || !(await this.airlines.isActive(flight.airline))) {
            throw new NotFoundException('New flight not found');
        }
        if (flight.status !== FlightStatus.SCHEDULED) {
            throw new BadRequestException(`Flight ${flight.flightNumber} is ${flight.status}`);
        }
        if (flight.departureTime <= now) {
            throw new BadRequestException(`Flight ${flight.flightNumber} has already departed`);
        }
        return flight;
    }

    /** Round trip: the outbound must still land before the return leaves */
    private async assertRoundTripOrder(booking: FlightBookingDocument, legIndex: number, next: FlightDocument) {
        if (booking.legs.length < 2) return;
        const otherLeg = booking.legs[legIndex === 0 ? 1 : 0];
        const other = await this.flightModel.findById(otherLeg.flight, { departureTime: 1, arrivalTime: 1 }).lean().exec();
        if (!other) return;
        if (legIndex === 0 && next.arrivalTime >= other.departureTime) {
            throw new BadRequestException('The new outbound flight must land before your return flight leaves');
        }
        if (legIndex === 1 && next.departureTime <= other.arrivalTime) {
            throw new BadRequestException('The new return flight must leave after your outbound flight lands');
        }
    }
}
