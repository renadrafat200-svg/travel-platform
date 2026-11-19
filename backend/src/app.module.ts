import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { AdminModule } from './admin/admin.module';
import { AirlinesModule } from './airlines/airlines.module';
import { AppController } from './app.controller';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { BlogModule } from './blog/blog.module';
import { FlightBookingsModule } from './flight-bookings/flight-bookings.module';
import { FlightsModule } from './flights/flights.module';
import { HotelBookingsModule } from './hotel-bookings/hotel-bookings.module';
import { HotelsModule } from './hotels/hotels.module';
import { ItinerariesModule } from './itineraries/itineraries.module';
import { MailModule } from './mail/mail.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PaymentsModule } from './payments/payments.module';
import { validateEnv } from './config/env.validation';
import { ReferenceDataModule } from './reference-data/reference-data.module';
import { ReportsModule } from './reports/reports.module';
import { ReviewsModule } from './reviews/reviews.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    // Loads backend/.env and stops the app at startup if a required variable is missing
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),

    // One shared connection to MongoDB Atlas for the whole app
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGODB_URI'),
      }),
    }),

    // Runs background jobs such as releasing expired seat holds
    ScheduleModule.forRoot(),

    // Feature modules. Add yours below, e.g. FlightsModule, HotelsModule ...
    UsersModule,
    AuthModule,
    AuditModule,
    NotificationsModule, // global, GEN-01 (Member 6)
    MailModule, // global, optional bonus: email
    AdminModule,
    ReportsModule,
    ReferenceDataModule,
    AirlinesModule,
    FlightsModule,
    FlightBookingsModule,
    HotelsModule,
    HotelBookingsModule,
    ReviewsModule,
    BlogModule,
    PaymentsModule, // PAY-01..04 (Member 6)
    ItinerariesModule, // ITN-01..26 (Member 7)
  ],
  controllers: [AppController],
})
export class AppModule {}
