import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ExchangeRatesModule } from '../exchange-rates/exchange-rates.module';
import { FlightBookingsModule } from '../flight-bookings/flight-bookings.module';
import { FlightsModule } from '../flights/flights.module';
import { HotelBookingsModule } from '../hotel-bookings/hotel-bookings.module';
import { HotelsModule } from '../hotels/hotels.module';
import { UsersModule } from '../users/users.module';
import { ItinerariesController } from './itineraries.controller';
import { ItinerariesService } from './itineraries.service';
import { ItineraryExtrasService } from './itinerary-extras.service';
import { ItineraryItemsController } from './itinerary-items.controller';
import { ItineraryItemsService } from './itinerary-items.service';
import { ItineraryPublicService } from './itinerary-public.service';
import {
  ActivityImageFile,
  ActivityImageFileSchema,
} from './schemas/activity-image-file.schema';
import { Itinerary, ItinerarySchema } from './schemas/itinerary.schema';

/**
 * Member 7: itineraries, budgets and exchange rates (ITN-01 to ITN-26).
 * Collection "itineraries" with owner / isPublic / isHidden is what Member 1's reports module
 * and Member 5's author page read.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Itinerary.name, schema: ItinerarySchema },
      { name: ActivityImageFile.name, schema: ActivityImageFileSchema },
    ]),
    UsersModule,
    ExchangeRatesModule,
    HotelsModule, // HotelSearchService (ITN-25)
    FlightsModule, // FlightSearchService (ITN-26)
    FlightBookingsModule, // ITN-27 (optional): attach flight bookings
    HotelBookingsModule, // ITN-27 (optional): attach hotel bookings
  ],
  controllers: [ItinerariesController, ItineraryItemsController],
  providers: [
    ItinerariesService,
    ItineraryItemsService,
    ItineraryPublicService,
    ItineraryExtrasService, // ITN-27, ITN-28 (optional)
  ],
  exports: [ItinerariesService],
})
export class ItinerariesModule {}
