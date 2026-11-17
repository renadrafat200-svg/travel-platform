import { Module } from '@nestjs/common';
import { AirlinesModule } from '../airlines/airlines.module';
import { FlightBookingsModule } from '../flight-bookings/flight-bookings.module';
import { HotelBookingsModule } from '../hotel-bookings/hotel-bookings.module';
import { HotelsModule } from '../hotels/hotels.module';
import { UsersModule } from '../users/users.module';
import { AdminAccountsController } from './admin-accounts.controller';
import { AdminAccountsService } from './admin-accounts.service';
import { AdminBookingsController } from './admin-bookings.controller';
import { AdminBookingsService } from './admin-bookings.service';
import { AdminProvidersController } from './admin-providers.controller';
import { AdminProvidersService } from './admin-providers.service';

/**
 * Admin features (Member 1): accounts and moderators (ACC-13 to ACC-16, ACC-07a),
 * airline/hotel deactivation (ACC-15) and the all-bookings view (ACC-17).
 * AuditService comes from the global AuditModule.
 */
@Module({
  imports: [UsersModule, AirlinesModule, HotelsModule, FlightBookingsModule, HotelBookingsModule],
  controllers: [AdminAccountsController, AdminProvidersController, AdminBookingsController],
  providers: [AdminAccountsService, AdminProvidersService, AdminBookingsService],
})
export class AdminModule {}
