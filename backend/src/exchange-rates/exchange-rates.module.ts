import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ExchangeRatesController } from './exchange-rates.controller';
import { ExchangeRatesService } from './exchange-rates.service';
import { ExchangeRate, ExchangeRateSchema } from './schemas/exchange-rate.schema';

/**
 * Member 7: exchange rates for itinerary budgets (ITN-18).
 * Rates come from FXRatesAPI (FXRATES_API_KEY in backend/.env) once per day and are cached
 * in the "exchangerates" collection.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ExchangeRate.name, schema: ExchangeRateSchema },
    ]),
  ],
  controllers: [ExchangeRatesController],
  providers: [ExchangeRatesService],
  exports: [ExchangeRatesService],
})
export class ExchangeRatesModule {}
