import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AirlinesModule } from '../airlines/airlines.module';
import { FlightSearchService } from './flight-search.service';
import { FlightsController } from './flights.controller';
import { FlightsService } from './flights.service';
import { Flight, FlightSchema } from './schemas/flight.schema';

/**
 * Flights, cabins and flight search.
 * Exports FlightsService and the Flight model so Member 3 (flight booking / seat holds)
 * can import FlightsModule and inject @InjectModel(Flight.name).
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Flight.name, schema: FlightSchema }]),
    AirlinesModule,
  ],
  controllers: [FlightsController],
  providers: [FlightsService, FlightSearchService],
  exports: [FlightsService, MongooseModule],
})
export class FlightsModule {}
