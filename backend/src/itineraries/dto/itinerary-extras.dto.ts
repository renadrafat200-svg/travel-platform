import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsMongoId, IsOptional, Matches } from 'class-validator';

/** POST /api/itineraries/:id/bookings (ITN-27, optional) */
export class AttachBookingDto {
  @ApiProperty({ enum: ['flight', 'hotel'] })
  @IsIn(['flight', 'hotel'])
  bookingType: 'flight' | 'hotel';

  @ApiProperty({ description: 'Id of one of my confirmed (or completed) bookings' })
  @IsMongoId()
  bookingId: string;
}

/** GET /api/itineraries/:id/pdf (ITN-28, optional) */
export class ItineraryPdfQueryDto {
  @ApiPropertyOptional({
    description: "Currency for the budget totals. Default: the viewer's preferred currency",
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter code like EUR' })
  currency?: string;
}
