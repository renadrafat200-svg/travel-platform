import {
    BadRequestException,
    ConflictException,
    Injectable,
    Logger,
    NotFoundException,
    OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomInt } from 'crypto';
import { Model, QueryFilter, Types } from 'mongoose';
import { AirlinesService } from '../airlines/airlines.service';
import { paginate } from '../common/dto/pagination-query.dto';
import { ProviderType, Role } from '../common/enums/role.enum';
import { AuthUser } from '../common/interfaces/auth-user.interface';
import { assertManagesProvider, assertOwnerOrAdmin } from '../common/utils/ownership';
import { FlightsService } from '../flights/flights.service';
import { Flight, FlightDocument, FlightStatus } from '../flights/schemas/flight.schema';
import {
    CancelFlightBookingDto,
    CreateFlightBookingDto,
    LegSelectionDto,
    MyFlightBookingsQueryDto,
    PassengerDto,
} from './dto/flight-booking.dto';
import {
    BOOKING_CUTOFF_MINUTES,
    CHILD_MAX_AGE,
    HOLD_MINUTES,
    INFANT_MAX_AGE,
    MAX_ACTIVE_HOLDS_PER_USER,
} from './flight-booking.constants';
import {
    BookingLeg,
    BookingStatus,
    FlightBooking,
    FlightBookingDocument,
    Passenger,
    PassengerType,
    RefundStatus,
} from './schemas/flight-booking.schema';
import { SeatInventoryService } from './seat-inventory.service';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** No 0/O or 1/I, so references are easy to read out loud */
const REFERENCE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

@Injectable()
export class FlightBookingsService implements OnModuleInit {
    private readonly logger = new Logger(FlightBookingsService.name);

    constructor(
        @InjectModel(FlightBooking.name)
        private readonly bookingModel: Model<FlightBooking>,
        @InjectModel(Flight.name) private readonly flightModel: Model<Flight>,
        private readonly seats: SeatInventoryService,
        private readonly flights: FlightsService,
        private readonly airlines: AirlinesService,
    ) { }

    /** When an airline cancels a flight (FLT-06), its bookings are cancelled here too */
    onModuleInit() {
        this.flights.onFlightCancelled((flightId, reason) => this.cancelAllForFlight(flightId, reason));
    }

    // =====================================================================================
    // Booking with a seat hold (FLT-22)
    // =====================================================================================

    /**
     * Holds the seats for HOLD_MINUTES and creates a pending booking with the full price.
     * The booking becomes confirmed only when Payments (Member 6) calls confirm().
     */
    async create(user: AuthUser, dto: CreateFlightBookingDto) {
        const activeHolds = await this.bookingModel.countDocuments({
            user: new Types.ObjectId(user.id),
            status: BookingStatus.PENDING,
            holdExpiresAt: { $gt: new Date() },
        });
        if (activeHolds >= MAX_ACTIVE_HOLDS_PER_USER) {
            throw new ConflictException(
                `You already have ${activeHolds} unpaid bookings. Pay for or cancel one first.`,
            );
        }

        const now = new Date();
        const cutoff = new Date(now.getTime() + BOOKING_CUTOFF_MINUTES * MINUTE);

        // 1. Load and check the flight(s)
        const outbound = await this.getBookableFlight(dto.outbound, cutoff);
        const back = dto.returnFlight ? await this.getBookableFlight(dto.returnFlight, cutoff) : null;
        if (back) {
            if (
                back.flight.origin !== outbound.flight.destination ||
                back.flight.destination !== outbound.flight.origin
            ) {
                throw new BadRequestException(
                    `The return flight must go from ${outbound.flight.destination} back to ${outbound.flight.origin}`,
                );
            }
            if (back.flight.departureTime <= outbound.flight.arrivalTime) {
                throw new BadRequestException(
                    'The return flight must leave after the outbound flight lands',
                );
            }
            if (back.flight.currency !== outbound.flight.currency) {
                throw new BadRequestException(
                    'Both flights must be priced in the same currency to be booked together. Book them separately.',
                );
            }
        }

        // 2. Passengers: work out adult/child/infant from the date of birth
        const passengers = this.buildPassengers(dto.passengers, outbound.flight.departureTime);
        const seatCount = passengers.filter((p) => p.type !== PassengerType.INFANT).length;

        // 3. Price every flight (fares + extra bags), copied into the booking
        const legs: BookingLeg[] = [];
        for (const sel of back ? [outbound, back] : [outbound]) {
            legs.push(await this.priceLeg(sel.flight, sel.cabinId, passengers, seatCount));
        }
        const totalAmount = round2(legs.reduce((sum, l) => sum + l.amount, 0));

        // 4. Take the seats: all flights or none, each one atomically
        const requests = legs.map((l) => ({
            flightId: l.flight,
            cabinId: l.cabinId,
            seats: l.seats,
            departsAfter: cutoff,
        }));
        await this.seats.takeAll(requests);

        // 5. Save the booking. If saving fails, give the seats back.
        try {
            const booking = await this.createWithUniqueReference({
                user: new Types.ObjectId(user.id),
                legs,
                passengers,
                totalAmount,
                currency: outbound.flight.currency,
                status: BookingStatus.PENDING,
                holdExpiresAt: new Date(Date.now() + HOLD_MINUTES * MINUTE),
            });
            return this.toView(booking);
        } catch (err) {
            await this.seats.releaseAll(requests);
            throw err;
        }
    }

    // =====================================================================================
    // Viewing
    // =====================================================================================

    /** The logged-in user's own flight bookings, newest first */
    async findMine(user: AuthUser, query: MyFlightBookingsQueryDto) {
        await this.expireOverdue({ user: new Types.ObjectId(user.id) });

        const filter: QueryFilter<FlightBooking> = {
            user: new Types.ObjectId(user.id),
        };
        if (query.status) filter.status = query.status;
        const [docs, total] = await Promise.all([
            this.bookingModel
                .find(filter)
                .sort({ createdAt: -1 })
                .skip(query.skip)
                .limit(query.limit)
                .exec(),
            this.bookingModel.countDocuments(filter).exec(),
        ]);
        return paginate(
            docs.map((d) => this.toView(d)),
            total,
            query,
        );
    }

    /** One booking. Only its owner or an admin can open it (403 otherwise). */
    async findOne(user: AuthUser, id: string) {
        const booking = await this.getOwned(user, id);
        return this.toView(booking);
    }

    /**
     * E-ticket for a confirmed booking: ticket numbers, passengers, and the flights with
     * their CURRENT times (so a schedule change shows up on the ticket).
     */
    async eTicket(user: AuthUser, id: string) {
        const booking = await this.getOwned(user, id);
        if (booking.status !== BookingStatus.CONFIRMED) {
            throw new BadRequestException('E-tickets are only available for confirmed (paid) bookings');
        }
        const flights = await Promise.all(
            booking.legs.map(async (leg) => {
                const flight = await this.flightModel.findById(leg.flight).exec();
                return flight ? this.flights.fullView(flight) : null;
            }),
        );
        return {
            reference: booking.reference,
            status: booking.status,
            issuedAt: booking.confirmedAt,
            totalPaid: booking.totalAmount,
            currency: booking.currency,
            flights: booking.legs.map((leg, i) => {
                const f = flights[i];
                return {
                    flightNumber: f?.flightNumber ?? leg.flightNumber,
                    airline: f?.airline,
                    cabinClass: leg.cabinClass,
                    flightStatus: f?.status,
                    departure: f?.departure,
                    arrival: f?.arrival,
                    durationMinutes: f?.durationMinutes,
                    passengers: booking.passengers.map((p, j) => ({
                        name: `${p.firstName} ${p.lastName}`,
                        type: p.type,
                        ticketNumber: leg.ticketNumbers[j],
                        extraBags: p.extraBags,
                    })),
                };
            }),
        };
    }

    /** Airline moderator: everyone with a confirmed ticket on one of their flights */
    async passengerList(user: AuthUser, flightId: string) {
        if (!Types.ObjectId.isValid(flightId)) throw new BadRequestException('Invalid flight id');
        const flight = await this.flightModel.findById(flightId).exec();
        if (!flight) throw new NotFoundException('Flight not found');
        assertManagesProvider(user, ProviderType.AIRLINE, flight.airline);

        const bookings = await this.bookingModel
            .find({ 'legs.flight': flight._id, status: BookingStatus.CONFIRMED })
            .sort({ confirmedAt: 1 })
            .exec();

        const items = bookings.flatMap((b) => {
            const leg = b.legs.find((l) => l.flight.equals(flight._id))!;
            return b.passengers.map((p, i) => ({
                bookingReference: b.reference,
                name: `${p.firstName} ${p.lastName}`,
                type: p.type,
                dateOfBirth: p.dateOfBirth,
                cabinClass: leg.cabinClass,
                extraBags: p.extraBags,
                ticketNumber: leg.ticketNumbers[i],
            }));
        });
        return {
            flight: {
                id: flight._id.toString(),
                flightNumber: flight.flightNumber,
                route: `${flight.origin}-${flight.destination}`,
                departureUtc: flight.departureTime.toISOString(),
                status: flight.status,
            },
            totalPassengers: items.length,
            seatedPassengers: items.filter((p) => p.type !== PassengerType.INFANT).length,
            infants: items.filter((p) => p.type === PassengerType.INFANT).length,
            items,
        };
    }

    // =====================================================================================
    // Cancelling
    // =====================================================================================

    /**
     * User cancels their booking.
     * - pending (not paid yet): seats go back, nothing to refund
     * - confirmed: seats go back, refund = the airline's cancellation policy for how many
     *   hours are left before each flight. Member 6 sends the money back.
     */
    async cancel(user: AuthUser, id: string, dto: CancelFlightBookingDto) {
        const booking = await this.getOwned(user, id);
        const by = user.role === Role.ADMIN ? 'admin' : 'user';

        if (booking.status === BookingStatus.PENDING) {
            const updated = await this.bookingModel
                .findOneAndUpdate(
                    { _id: booking._id, status: BookingStatus.PENDING },
                    {
                        $set: {
                            status: BookingStatus.CANCELLED,
                            cancelledAt: new Date(),
                            cancelledBy: by,
                            cancellationReason: dto.reason,
                            refundPercent: 0,
                            refundAmount: 0,
                            refundStatus: RefundStatus.NONE,
                        },
                    },
                    { returnDocument: 'after' },
                )
                .exec();
            if (!updated) throw new ConflictException('This booking changed meanwhile; please reload it');
            await this.releaseSeats(updated);
            return this.toView(updated);
        }

        if (booking.status !== BookingStatus.CONFIRMED) {
            throw new BadRequestException(`This booking is already ${booking.status}`);
        }

        // Confirmed: refund per flight, using each flight's CURRENT departure time
        const now = Date.now();
        let refundAmount = 0;
        for (const leg of booking.legs) {
            const flight = await this.flightModel
                .findById(leg.flight, { departureTime: 1 })
                .lean()
                .exec();
            const departure = flight?.departureTime ?? leg.departureTime;
            if (departure.getTime() <= now) {
                throw new BadRequestException(
                    `Flight ${leg.flightNumber} has already departed, so this booking can no longer be cancelled`,
                );
            }
            const hoursLeft = (departure.getTime() - now) / HOUR;
            const percent = await this.airlines.refundPercent(leg.airline, hoursLeft);
            refundAmount += (leg.amount * percent) / 100;
        }
        refundAmount = round2(refundAmount);
        const refundPercent =
            booking.totalAmount > 0 ? Math.round((refundAmount / booking.totalAmount) * 100) : 0;

        const updated = await this.bookingModel
            .findOneAndUpdate(
                { _id: booking._id, status: BookingStatus.CONFIRMED },
                {
                    $set: {
                        status: BookingStatus.CANCELLED,
                        cancelledAt: new Date(),
                        cancelledBy: by,
                        cancellationReason: dto.reason,
                        refundPercent,
                        refundAmount,
                        refundStatus: refundAmount > 0 ? RefundStatus.PENDING : RefundStatus.NONE,
                    },
                },
                { returnDocument: 'after' },
            )
            .exec();
        if (!updated) throw new ConflictException('This booking changed meanwhile; please reload it');
        await this.releaseSeats(updated);
        // TODO (Member 6): issue the Stripe refund for refundAmount, then call markRefunded(id).
        // TODO (Member 6): notify the user that the booking was cancelled.
        return this.toView(updated);
    }

    /**
     * The airline cancelled a flight (called automatically from FlightsService.cancel).
     * Every booking on it is cancelled; paid ones get a FULL refund, whatever the policy says.
     */
    async cancelAllForFlight(flightId: Types.ObjectId, reason?: string) {
        const bookings = await this.bookingModel
            .find({
                'legs.flight': flightId,
                status: { $in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
            })
            .exec();

        let cancelled = 0;
        for (const b of bookings) {
            const paid = b.status === BookingStatus.CONFIRMED;
            const updated = await this.bookingModel
                .findOneAndUpdate(
                    { _id: b._id, status: b.status },
                    {
                        $set: {
                            status: BookingStatus.CANCELLED,
                            cancelledAt: new Date(),
                            cancelledBy: 'airline',
                            cancellationReason: reason ?? 'Flight cancelled by the airline',
                            refundPercent: paid ? 100 : 0,
                            refundAmount: paid ? b.totalAmount : 0,
                            refundStatus: paid && b.totalAmount > 0 ? RefundStatus.PENDING : RefundStatus.NONE,
                        },
                    },
                    { returnDocument: 'after' },
                )
                .exec();
            if (!updated) continue; // someone else changed it first; they already handled the seats
            await this.releaseSeats(updated);
            cancelled++;
            // TODO (Member 6): refund paid bookings in full and notify each user.
        }
        if (cancelled)
            this.logger.log(
                `Cancelled ${cancelled} booking(s) on cancelled flight ${flightId.toString()}`,
            );
        return { cancelled };
    }

    // =====================================================================================
    // Hold expiry
    // =====================================================================================

    /**
     * Expires every pending booking whose hold time has passed and gives its seats back.
     * Called every minute by HoldExpiryJob, and also just before a user lists their bookings.
     */
    async expireOverdue(extraFilter: QueryFilter<FlightBooking> = {}): Promise<number> {
        const overdue = await this.bookingModel
            .find(
                {
                    ...extraFilter,
                    status: BookingStatus.PENDING,
                    holdExpiresAt: { $lte: new Date() },
                },
                { _id: 1 },
            )
            .limit(500)
            .lean()
            .exec();

        let count = 0;
        for (const { _id } of overdue) {
            // The status condition makes this safe even if two jobs run at once:
            // only one of them can turn "pending" into "expired", so seats are returned once.
            const expired = await this.bookingModel
                .findOneAndUpdate(
                    {
                        _id,
                        status: BookingStatus.PENDING,
                        holdExpiresAt: { $lte: new Date() },
                    },
                    { $set: { status: BookingStatus.EXPIRED, expiredAt: new Date() } },
                    { returnDocument: 'after' },
                )
                .exec();
            if (!expired) continue;
            await this.releaseSeats(expired);
            count++;
        }
        return count;
    }

    // =====================================================================================
    // For Member 6 (payments). Same idea as the hotel booking service.
    // =====================================================================================

    /** What to charge. Throws if the booking is not the user's, not pending, or the hold ran out. */
    async getForPayment(user: AuthUser, id: string) {
        const booking = await this.getOwned(user, id);
        if (booking.status !== BookingStatus.PENDING) {
            throw new BadRequestException(`This booking is ${booking.status} and cannot be paid`);
        }
        return {
            bookingType: 'flight' as const,
            bookingId: booking._id.toString(),
            reference: booking.reference,
            amount: booking.totalAmount,
            currency: booking.currency,
            holdExpiresAt: booking.holdExpiresAt,
        };
    }

    /**
     * Call ONLY after the Stripe webhook says the payment succeeded.
     * Confirms the booking and issues one ticket number per passenger per flight.
     * Throws 409 if the hold already expired (then Member 6 must refund the payment).
     */
    async confirm(id: string, paymentReference: string) {
        const booking = await this.bookingModel.findById(id).exec();
        if (!booking) throw new NotFoundException('Booking not found');
        if (booking.status === BookingStatus.CONFIRMED) return this.toView(booking); // webhook retried

        const airlines = await this.airlines.summaries(booking.legs.map((l) => l.airline));
        // toObject() first: spreading a Mongoose sub-document would not copy its fields
        const legs = booking.toObject().legs.map((leg) => ({
            ...leg,
            ticketNumbers: booking.passengers.map(() =>
                this.ticketNumber(airlines.get(leg.airline.toString())?.iataCode),
            ),
        }));

        const confirmed = await this.bookingModel
            .findOneAndUpdate(
                {
                    _id: booking._id,
                    status: BookingStatus.PENDING,
                    holdExpiresAt: { $gt: new Date() },
                },
                {
                    $set: {
                        status: BookingStatus.CONFIRMED,
                        confirmedAt: new Date(),
                        paymentReference,
                        legs,
                    },
                },
                { returnDocument: 'after' },
            )
            .exec();
        if (!confirmed) {
            throw new ConflictException(
                'The seat hold expired or the booking was cancelled before payment',
            );
        }
        // TODO (Member 6): notify the user that the booking is confirmed.
        return this.toView(confirmed);
    }

    /** Member 6 calls this after the refund went through on Stripe */
    async markRefunded(id: string) {
        await this.bookingModel
            .updateOne(
                { _id: id, refundStatus: RefundStatus.PENDING },
                { $set: { refundStatus: RefundStatus.REFUNDED } },
            )
            .exec();
    }

    // =====================================================================================
    // Private helpers
    // =====================================================================================

    private async getBookableFlight(sel: LegSelectionDto, cutoff: Date) {
        const flight = await this.flightModel.findById(sel.flightId).exec();
        if (!flight) throw new NotFoundException('Flight not found');
        if (!(await this.airlines.isActive(flight.airline))) {
            throw new NotFoundException('Flight not found'); // deactivated airline: hidden from the public
        }
        if (flight.status !== FlightStatus.SCHEDULED) {
            throw new BadRequestException(`Flight ${flight.flightNumber} is cancelled`);
        }
        if (flight.departureTime <= cutoff) {
            throw new BadRequestException(
                `Online booking closes ${BOOKING_CUTOFF_MINUTES / 60} hours before departure`,
            );
        }
        const cabin = flight.cabins.find((c) => c.cabinClass === sel.cabinClass);
        if (!cabin) {
            throw new BadRequestException(`Flight ${flight.flightNumber} has no ${sel.cabinClass} cabin`);
        }
        return { flight, cabinId: cabin._id };
    }

    private buildPassengers(list: PassengerDto[], travelDate: Date): Passenger[] {
        const passengers = list.map((p) => {
            const age = this.ageOn(p.dateOfBirth, travelDate);
            const type =
                age < INFANT_MAX_AGE
                    ? PassengerType.INFANT
                    : age < CHILD_MAX_AGE
                        ? PassengerType.CHILD
                        : PassengerType.ADULT;
            if (type === PassengerType.INFANT && (p.extraBags ?? 0) > 0) {
                throw new BadRequestException('Infants cannot have extra bags');
            }
            return {
                firstName: p.firstName.trim(),
                lastName: p.lastName.trim(),
                dateOfBirth: p.dateOfBirth,
                type,
                extraBags: p.extraBags ?? 0,
            };
        });
        const adults = passengers.filter((p) => p.type === PassengerType.ADULT).length;
        const infants = passengers.filter((p) => p.type === PassengerType.INFANT).length;
        if (adults === 0) {
            throw new BadRequestException('Every booking needs at least one adult (12 or older)');
        }
        if (infants > adults) {
            throw new BadRequestException('Each infant must travel on the lap of a different adult');
        }
        return passengers;
    }

    /** Full years between the date of birth and the travel date */
    private ageOn(dob: string, on: Date): number {
        const [y, m, d] = dob.split('-').map(Number);
        const birth = new Date(Date.UTC(y, m - 1, d));
        if (
            Number.isNaN(birth.getTime()) ||
            birth.getUTCFullYear() !== y ||
            birth.getUTCMonth() !== m - 1 ||
            birth.getUTCDate() !== d
        ) {
            throw new BadRequestException(`${dob} is not a real date`);
        }
        if (birth > on) throw new BadRequestException('A passenger cannot be born after the flight');
        let age = on.getUTCFullYear() - y;
        const birthdayPassed =
            on.getUTCMonth() > m - 1 || (on.getUTCMonth() === m - 1 && on.getUTCDate() >= d);
        if (!birthdayPassed) age--;
        return age;
    }

    private async priceLeg(
        flight: FlightDocument,
        cabinId: Types.ObjectId,
        passengers: Passenger[],
        seats: number,
    ): Promise<BookingLeg> {
        const cabin = flight.cabins.id(cabinId)!;
        const fareAmount = round2(passengers.reduce((sum, p) => sum + cabin.prices[p.type], 0));

        const bags = passengers.reduce((sum, p) => sum + p.extraBags, 0);
        let baggageAmount = 0;
        if (bags > 0) {
            const { baggagePolicy } = await this.airlines.getPolicies(flight.airline.toString());
            if (baggagePolicy.currency !== flight.currency) {
                throw new BadRequestException(
                    `Extra bags on flight ${flight.flightNumber} are priced in ${baggagePolicy.currency}, ` +
                    `not ${flight.currency}, so they cannot be added online`,
                );
            }
            baggageAmount = round2(bags * baggagePolicy.extraBagFee);
        }

        return {
            flight: flight._id,
            airline: flight.airline,
            cabinId,
            cabinClass: cabin.cabinClass,
            flightNumber: flight.flightNumber,
            origin: flight.origin,
            destination: flight.destination,
            departureTime: flight.departureTime,
            seats,
            fareAmount,
            baggageAmount,
            amount: round2(fareAmount + baggageAmount),
            ticketNumbers: [],
        };
    }

    private async getOwned(user: AuthUser, id: string): Promise<FlightBookingDocument> {
        if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid booking id');
        let booking = await this.bookingModel.findById(id).exec();
        if (!booking) throw new NotFoundException('Booking not found');
        assertOwnerOrAdmin(user, booking.user);

        // A hold that ran out but the job has not reached yet: expire it now
        if (booking.status === BookingStatus.PENDING && booking.holdExpiresAt <= new Date()) {
            await this.expireOverdue({ _id: booking._id });
            booking = (await this.bookingModel.findById(id).exec())!;
        }
        return booking;
    }

    private releaseSeats(booking: FlightBooking) {
        return this.seats.releaseAll(
            booking.legs.map((l) => ({
                flightId: l.flight,
                cabinId: l.cabinId,
                seats: l.seats,
            })),
        );
    }

    private async createWithUniqueReference(data: Partial<FlightBooking>) {
        for (let attempt = 0; ; attempt++) {
            try {
                return await this.bookingModel.create({
                    ...data,
                    reference: this.newReference(),
                });
            } catch (err) {
                const duplicate = (err as { code?: number }).code === 11000;
                if (!duplicate || attempt >= 4) throw err;
            }
        }
    }

    private newReference(): string {
        let ref = '';
        for (let i = 0; i < 6; i++) ref += REFERENCE_CHARS[randomInt(REFERENCE_CHARS.length)];
        return ref;
    }

    /** e.g. "MS-4829105736" */
    private ticketNumber(airlineCode = 'XX'): string {
        let digits = '';
        for (let i = 0; i < 10; i++) digits += randomInt(10).toString();
        return `${airlineCode}-${digits}`;
    }

    private toView(b: FlightBookingDocument) {
        const pending = b.status === BookingStatus.PENDING;
        return {
            id: b._id.toString(),
            reference: b.reference,
            status: b.status,
            holdExpiresAt: pending ? b.holdExpiresAt : undefined,
            holdSecondsLeft: pending
                ? Math.max(0, Math.floor((b.holdExpiresAt.getTime() - Date.now()) / 1000))
                : undefined,
            totalAmount: b.totalAmount,
            currency: b.currency,
            flights: b.legs.map((l) => ({
                flightId: l.flight.toString(),
                flightNumber: l.flightNumber,
                route: `${l.origin}-${l.destination}`,
                departureUtc: l.departureTime.toISOString(),
                cabinClass: l.cabinClass,
                seats: l.seats,
                fareAmount: l.fareAmount,
                baggageAmount: l.baggageAmount,
                amount: l.amount,
            })),
            passengers: b.passengers.map((p) => ({
                firstName: p.firstName,
                lastName: p.lastName,
                dateOfBirth: p.dateOfBirth,
                type: p.type,
                extraBags: p.extraBags,
            })),
            confirmedAt: b.confirmedAt,
            cancelledAt: b.cancelledAt,
            cancelledBy: b.cancelledBy,
            cancellationReason: b.cancellationReason,
            refundPercent: b.refundPercent,
            refundAmount: b.refundAmount,
            refundStatus: b.refundStatus,
            expiredAt: b.expiredAt,
            createdAt: b.createdAt,
        };
    }
}