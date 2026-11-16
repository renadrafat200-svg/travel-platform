import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HotelsModule } from '../hotels/hotels.module';
import { UsersModule } from '../users/users.module';
import {
  HotelBookingsController,
  HotelReservationsController,
} from './hotel-bookings.controller';
import { HotelBookingsService } from './hotel-bookings.service';
import { HotelHoldExpiryJob } from './hotel-hold-expiry.job';
import {
  HotelBooking,
  HotelBookingSchema,
} from './schemas/hotel-booking.schema';

/**
 * Hotel booking (Member 4): multi-room bookings in one transaction, holds that expire,
 * cancellation with refunds from the hotel's policy, and the moderator reservations view.
 * Exports HotelBookingsService so Payments (Member 6) can call getForPayment(), confirm() and
 * markRefunded(), Reviews (Member 5) can call getCompletedStay(), and Admin (Member 1) listAll().
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: HotelBooking.name, schema: HotelBookingSchema },
    ]),
    HotelsModule, // Hotel and Room models, HotelsService, RoomInventoryService
    UsersModule,
  ],
  controllers: [HotelBookingsController, HotelReservationsController],
  providers: [HotelBookingsService, HotelHoldExpiryJob],
  exports: [HotelBookingsService, MongooseModule],
})
export class HotelBookingsModule {}
