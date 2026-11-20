import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsEnum, IsMongoId } from 'class-validator';
import { BookingType } from '../schemas/policy-acceptance.schema';

/** Path params of /api/bookings/:type/:id/... */
export class BookingParamsDto {
  @ApiProperty({ enum: BookingType, description: 'flight or hotel' })
  @IsEnum(BookingType, { message: 'type must be flight or hotel' })
  type: BookingType;

  @ApiProperty({ description: 'Booking (flight) or reservation (hotel) id' })
  @IsMongoId({ message: 'id must be a valid booking id' })
  id: string;
}

export class AcceptPoliciesDto {
  @ApiProperty({ example: true, description: 'PAY-02: the acceptance checkbox; must be true' })
  @Equals(true, { message: "You must accept the provider's policies before paying" })
  accepted: boolean;
}
