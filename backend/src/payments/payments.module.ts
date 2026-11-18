import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Airline, AirlineSchema } from '../airlines/schemas/airline.schema';
import { FlightBookingsModule } from '../flight-bookings/flight-bookings.module';
import { HotelBookingsModule } from '../hotel-bookings/hotel-bookings.module';
import { HotelsModule } from '../hotels/hotels.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PoliciesController } from './policies.controller';
import { RefundsController } from './refunds.controller';
import { RefundsService } from './refunds.service';
import { Payment, PaymentSchema } from './schemas/payment.schema';
import { Refund, RefundSchema } from './schemas/refund.schema';
import { StripeService } from './stripe.service';
import { PoliciesService } from './policies.service';
import { PolicyAcceptance, PolicyAcceptanceSchema } from './schemas/policy-acceptance.schema';

/**
 * Member 6: payments (PAY-01), policies before payment (PAY-02), refunds (PAY-03).
 * Uses the FlightBooking / HotelBooking / Hotel models exported by the booking and hotel modules.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PolicyAcceptance.name, schema: PolicyAcceptanceSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: Refund.name, schema: RefundSchema },
      { name: Airline.name, schema: AirlineSchema },
    ]),
    FlightBookingsModule,
    HotelBookingsModule,
    HotelsModule,
  ],
  controllers: [PoliciesController, PaymentsController, RefundsController],
  providers: [PoliciesService, StripeService, PaymentsService, RefundsService],
  exports: [PoliciesService, PaymentsService, RefundsService],
})
export class PaymentsModule {}
