import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { validateEnv } from './config/env.validation';

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

    // Feature modules go here as they are built, e.g. AuthModule, UsersModule, FlightsModule ...
  ],
  controllers: [AppController],
})
export class AppModule {}
