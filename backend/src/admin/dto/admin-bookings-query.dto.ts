import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsMongoId, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export enum AdminBookingType {
  FLIGHT = 'flight',
  HOTEL = 'hotel',
}

/** Every status a flight or hotel booking can have */
export enum AdminBookingStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
}

/** ACC-17: filters for GET /api/admin/bookings. No example values, so Swagger starts with empty filters. */
export class AdminBookingsQueryDto extends PaginationQueryDto {
  @ApiProperty({ enum: AdminBookingType, description: 'Which bookings to list' })
  @IsEnum(AdminBookingType)
  type: AdminBookingType;

  @ApiPropertyOptional({ enum: AdminBookingStatus, description: '"completed" applies to hotel bookings only' })
  @IsOptional()
  @IsEnum(AdminBookingStatus)
  status?: AdminBookingStatus;

  @ApiPropertyOptional({ description: 'Only bookings made by this user id' })
  @IsOptional()
  @IsMongoId()
  userId?: string;

  @ApiPropertyOptional({ description: 'Only bookings with this airline id (type=flight) or hotel id (type=hotel)' })
  @IsOptional()
  @IsMongoId()
  providerId?: string;

  @ApiPropertyOptional({
    description: 'From this date (YYYY-MM-DD). Flights: departure date. Hotels: check-in date.',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description: 'Up to this date, inclusive (YYYY-MM-DD). Flights: departure date. Hotels: check-in date.',
  })
  @IsOptional()
  @IsDateString()
  to?: string;
}
