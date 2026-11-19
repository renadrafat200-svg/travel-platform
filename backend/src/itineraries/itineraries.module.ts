import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ExchangeRatesModule } from '../exchange-rates/exchange-rates.module';
import { FlightsModule } from '../flights/flights.module';
import { HotelsModule } from '../hotels/hotels.module';
import { UsersModule } from '../users/users.module';
import { ItinerariesController } from './itineraries.controller';
import { ItinerariesService } from './itineraries.service';
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
  ],
  controllers: [ItinerariesController, ItineraryItemsController],
  providers: [ItinerariesService, ItineraryItemsService, ItineraryPublicService],
  exports: [ItinerariesService],
})
export class ItinerariesModule {}
