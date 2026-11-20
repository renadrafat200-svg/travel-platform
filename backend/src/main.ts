import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  // rawBody: true keeps the raw request body available for the Stripe webhook signature check
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const config = app.get(ConfigService);

  // Every route starts with /api, e.g. /api/auth/login
  app.setGlobalPrefix('api');

  // Reads the httpOnly auth cookie on incoming requests
  app.use(cookieParser());

  // Lets the Next.js frontend (Milestone 2) send cookies to this API
  app.enableCors({
    origin: config.get<string>('FRONTEND_URL') ?? 'http://localhost:3001',
    credentials: true,
  });

  // Validates every request body/query against its DTO and strips unknown fields
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Same error shape for every error: { statusCode, error, message, path, timestamp }
  app.useGlobalFilters(new AllExceptionsFilter());

  // Swagger UI at http://localhost:3000/api/docs
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Travel Planning and Booking Platform API')
    .setDescription('Milestone 1 backend: NestJS + MongoDB Atlas')
    .setVersion('1.0')
    .addCookieAuth('access_token')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { withCredentials: true, persistAuthorization: true },
  });

  const port = config.get<number>('PORT') ?? 3000;
  await app.listen(port);
  console.log(`API running on http://localhost:${port}/api`);
  console.log(`Swagger docs on http://localhost:${port}/api/docs`);
}
void bootstrap();
