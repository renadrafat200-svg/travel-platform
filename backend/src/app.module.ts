import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminModule } from './admin/admin.module';
import { AppController } from './app.controller';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
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

    // Feature modules. Add yours below, e.g. FlightsModule, HotelsModule ...
    UsersModule,
    AuthModule,
    AuditModule,
    AdminModule,
    ReportsModule,
    ReferenceDataModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
