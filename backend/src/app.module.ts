import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { AdminModule } from './admin/admin.module';
import { AirlinesModule } from './airlines/airlines.module';
import { AppController } from './app.controller';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { FlightBookingsModule } from './flight-bookings/flight-bookings.module';
import { FlightsModule } from './flights/flights.module';
import { validateEnv } from './config/env.validation';
import { ReferenceDataModule } from './reference-data/reference-data.module';
import { ReportsModule } from './reports/reports.module';
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
    AdminModule,
    ReportsModule,
    ReferenceDataModule,
    AirlinesModule,
    FlightsModule,
    FlightBookingsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
