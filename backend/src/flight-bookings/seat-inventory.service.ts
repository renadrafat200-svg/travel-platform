import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Flight, FlightStatus } from '../flights/schemas/flight.schema';

export interface SeatRequest {
    flightId: Types.ObjectId;
    cabinId: Types.ObjectId;
    seats: number;
    /** Seats can only be taken if the flight still departs after this moment */
    departsAfter: Date;
}

/**
 * The only place that changes a cabin's availableSeats for bookings (FLT-22).
 *
 * Why it is concurrency-safe: taking seats is ONE atomic MongoDB update whose filter says
 * "only if availableSeats >= seats". MongoDB applies the check and the decrement together,
 * so if 2 people race for the last seat, exactly one update matches and the other one
 * matches nothing (modifiedCount = 0). The seat count can never go below zero.
 */
@Injectable()
export class SeatInventoryService {
    private readonly logger = new Logger(SeatInventoryService.name);

    constructor(@InjectModel(Flight.name) private readonly flightModel: Model<Flight>) { }

    /** Takes seats on one cabin. Returns false (and changes nothing) if there are not enough. */
    async take(req: SeatRequest): Promise<boolean> {
        const res = await this.flightModel
            .updateOne(
                {
                    _id: req.flightId,
                    status: FlightStatus.SCHEDULED,
                    departureTime: { $gt: req.departsAfter },
                    cabins: {
                        $elemMatch: {
                            _id: req.cabinId,
                            availableSeats: { $gte: req.seats },
                        },
                    },
                },
                // "cabins.$" = the cabin matched by $elemMatch above
                { $inc: { 'cabins.$.availableSeats': -req.seats } },
            )
            .exec();
        return res.modifiedCount === 1;
    }

    /**
     * Takes seats on every flight of a trip, or on none of them.
     * If the return flight is full after the outbound seats were taken, the outbound seats
     * are given back straight away, so a failed round trip never keeps seats.
     */
    async takeAll(requests: SeatRequest[]): Promise<void> {
        const taken: SeatRequest[] = [];
        for (const req of requests) {
            if (!(await this.take(req))) {
                await this.releaseAll(taken);
                throw new ConflictException(
                    requests.length > 1 && taken.length > 0
                        ? 'Not enough seats left on the return flight in this cabin'
                        : 'Not enough seats left on this flight in this cabin',
                );
            }
            taken.push(req);
        }
    }

    /** Gives seats back to a cabin (hold expired, booking cancelled, or a failed round trip) */
    async release(flightId: Types.ObjectId, cabinId: Types.ObjectId, seats: number): Promise<void> {
        const res = await this.flightModel
            .updateOne(
                { _id: flightId, 'cabins._id': cabinId },
                { $inc: { 'cabins.$.availableSeats': seats } },
            )
            .exec();
        if (res.modifiedCount !== 1) {
            // Only happens if the cabin was deleted; there is nothing to give back to.
            this.logger.warn(`Could not return ${seats} seat(s) to flight ${flightId.toString()}`);
        }
    }

    async releaseAll(requests: Pick<SeatRequest, 'flightId' | 'cabinId' | 'seats'>[]) {
        for (const r of requests) await this.release(r.flightId, r.cabinId, r.seats);
    }
}