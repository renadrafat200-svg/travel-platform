import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { DATE } from '../../hotels/dto/hotel.dto';
import { MAX_ROOMS_PER_BOOKING } from '../../hotels/hotel.constants';
import { HotelBookingStatus } from '../schemas/hotel-booking.schema';

/** One room of the reservation and who stays in it */
export class RoomSelectionDto {
  @ApiProperty({
    example: '6a0f1c2d3e4f5a6b7c8d9e0f',
    description: 'roomId from GET /api/hotels/:id/rooms/available',
  })
  @IsMongoId()
  roomId: string;

  @ApiProperty({ example: 2, minimum: 0, description: 'Adults in this room' })
  @IsInt()
  @Min(0)
  @Max(20)
  adults: number;

  @ApiPropertyOptional({
    example: 0,
    minimum: 0,
    default: 0,
    description: 'Children aged 0-17 in this room',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  children?: number;
}

/** POST /api/hotel-bookings (HTL-16, HTL-18) */
export class CreateHotelBookingDto {
  @ApiProperty({ example: '6a0f1c2d3e4f5a6b7c8d9e01' })
  @IsMongoId()
  hotelId: string;

  @ApiProperty({
    example: '2026-12-01',
    description: 'First night, hotel local date',
  })
  @Matches(DATE, { message: 'checkIn must look like 2026-12-01' })
  checkIn: string;

  @ApiProperty({
    example: '2026-12-04',
    description: 'Day you leave (not a night)',
  })
  @Matches(DATE, { message: 'checkOut must look like 2026-12-04' })
  checkOut: string;

  @ApiProperty({
    type: [RoomSelectionDto],
    description:
      'One or more different rooms of this hotel, all for the same dates',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ROOMS_PER_BOOKING)
  @ValidateNested({ each: true })
  @Type(() => RoomSelectionDto)
  rooms: RoomSelectionDto[];
}

/** POST /api/hotel-bookings/:id/cancel */
export class CancelHotelBookingDto {
  @ApiPropertyOptional({ description: 'Why you are cancelling' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export const RESERVATION_GROUPS = ['upcoming', 'past', 'cancelled'] as const;
export type ReservationGroup = (typeof RESERVATION_GROUPS)[number];

/** GET /api/hotel-bookings (HTL-20) */
export class MyHotelBookingsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: RESERVATION_GROUPS,
    description:
      'Only one group, paginated. Without it, all three groups are returned (first page each).',
  })
  @IsOptional()
  @IsIn(RESERVATION_GROUPS)
  group?: ReservationGroup;
}

/** GET /api/hotels/:id/bookings (HTL-22) */
export class HotelReservationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: HotelBookingStatus })
  @IsOptional()
  @IsEnum(HotelBookingStatus)
  status?: HotelBookingStatus;

  @ApiPropertyOptional({
    description: 'Stays that end after this date (YYYY-MM-DD)',
  })
  @IsOptional()
  @Matches(DATE, { message: 'from must look like 2026-12-01' })
  from?: string;

  @ApiPropertyOptional({
    description: 'Stays that start before this date (YYYY-MM-DD)',
  })
  @IsOptional()
  @Matches(DATE, { message: 'to must look like 2026-12-31' })
  to?: string;

  @ApiPropertyOptional({
    description: 'Only reservations that include this room',
  })
  @IsOptional()
  @IsMongoId()
  roomId?: string;
}
