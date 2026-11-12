import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AirlinesModule } from '../airlines/airlines.module';
import { FlightsModule } from '../flights/flights.module';
import { FlightBookingsController, FlightPassengersController } from './flight-bookings.controller';
import { FlightBookingsService } from './flight-bookings.service';
import { HoldExpiryJob } from './hold-expiry.job';
import { FlightBooking, FlightBookingSchema } from './schemas/flight-booking.schema';
import { SeatInventoryService } from './seat-inventory.service';

/**
 * Flight booking (Member 3): seat holds, expiry, cancellation, e-tickets, passenger lists.
 * Exports FlightBookingsService so Payments (Member 6) can call getForPayment(), confirm()
 * and markRefunded(), and Admin (Member 1) can read bookings.
 */
@Module({
    imports: [
        MongooseModule.forFeature([{ name: FlightBooking.name, schema: FlightBookingSchema }]),
        FlightsModule, // gives the Flight model and FlightsService
        AirlinesModule,
    ],
    controllers: [FlightBookingsController, FlightPassengersController],
    providers: [FlightBookingsService, SeatInventoryService, HoldExpiryJob],
    exports: [FlightBookingsService, MongooseModule],
})
export class FlightBookingsModule { }