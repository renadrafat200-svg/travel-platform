import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AirlinesController } from './airlines.controller';
import { AirlinesService } from './airlines.service';
import { AirlineLogoFile, AirlineLogoFileSchema } from './schemas/airline-logo-file.schema';
import { Airline, AirlineSchema } from './schemas/airline.schema';

/**
 * Airlines and their baggage/cancellation policies.
 * Exports AirlinesService so Flights, Admin (deactivation) and Payments (refunds) can use it.
 * ReferenceDataService and AuditService come from global modules.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Airline.name, schema: AirlineSchema },
      { name: AirlineLogoFile.name, schema: AirlineLogoFileSchema },
    ]),
  ],
  controllers: [AirlinesController],
  providers: [AirlinesService],
  exports: [AirlinesService],
})
export class AirlinesModule {}
