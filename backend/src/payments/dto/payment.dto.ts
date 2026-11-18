import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsMongoId, IsOptional } from 'class-validator';
import { BookingType } from '../schemas/policy-acceptance.schema';

/** Stripe's ready-made test cards. Only accepted while STRIPE_SECRET_KEY is a test key. */
export const TEST_PAYMENT_METHODS = [
  'pm_card_visa',
  'pm_card_mastercard',
  'pm_card_chargeDeclined',
  'pm_card_chargeDeclinedInsufficientFunds',
] as const;

export class TestPaymentMethodDto {
  @ApiPropertyOptional({
    enum: TEST_PAYMENT_METHODS,
    description:
      'Swagger testing only (test key): confirms the PaymentIntent on the server with a Stripe test card. ' +
      'pm_card_visa succeeds, pm_card_chargeDeclined fails. Leave empty when the frontend uses Stripe Elements.',
  })
  @IsOptional()
  @IsIn(TEST_PAYMENT_METHODS)
  testPaymentMethod?: (typeof TEST_PAYMENT_METHODS)[number];
}

export class CreatePaymentDto extends TestPaymentMethodDto {
  @ApiProperty({ enum: BookingType, example: BookingType.HOTEL })
  @IsEnum(BookingType, { message: 'bookingType must be flight or hotel' })
  bookingType: BookingType;

  @ApiProperty({ description: 'Id of a Pending Payment flight booking or hotel reservation' })
  @IsMongoId({ message: 'bookingId must be a valid booking id' })
  bookingId: string;
}

export class RetryPaymentDto extends TestPaymentMethodDto {}
