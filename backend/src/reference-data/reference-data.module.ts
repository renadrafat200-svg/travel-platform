import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReferenceDataController } from './reference-data.controller';
import { ReferenceDataService } from './reference-data.service';
import { ReferenceSeederService } from './reference-seeder.service';
import {
  Airport,
  AirportSchema,
  Attraction,
  AttractionSchema,
  City,
  CitySchema,
  Country,
  CountrySchema,
} from './schemas/reference.schemas';

/**
 * @Global so Flights, Hotels and Itineraries can inject ReferenceDataService directly.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Country.name, schema: CountrySchema },
      { name: City.name, schema: CitySchema },
      { name: Airport.name, schema: AirportSchema },
      { name: Attraction.name, schema: AttractionSchema },
    ]),
  ],
  controllers: [ReferenceDataController],
  providers: [ReferenceDataService, ReferenceSeederService],
  exports: [ReferenceDataService],
})
export class ReferenceDataModule {}
