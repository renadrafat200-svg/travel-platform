import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
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
} from 'class-validator';
import { CabinClass } from '../../flights/schemas/flight.schema';
import { MAX_ROOMS_PER_BOOKING } from '../../hotels/hotel.constants';
import { DATE_REGEX, MAX_DAYS } from '../itinerary.constants';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

class PageQuery {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 10;

  get skip(): number {
    return (this.page - 1) * this.limit;
  }
}

/** GET /api/itineraries/public/search (ITN-21) */
export class PublicSearchQueryDto extends PageQuery {
  @ApiPropertyOptional({
    description: 'Matches the title, a country (code or name) or a city (id or name)',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  keyword?: string;

  @ApiPropertyOptional({ description: 'Country code from GET /api/countries' })
  @IsOptional()
  @Transform(upper)
  @IsString()
  country?: string;

  @ApiPropertyOptional({ description: 'City id from GET /api/cities' })
  @IsOptional()
  @Transform(lower)
  @IsString()
  city?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_DAYS, description: 'Shortest trip, in days' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_DAYS)
  minDays?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_DAYS, description: 'Longest trip, in days' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_DAYS)
  maxDays?: number;
}

/** GET /api/itineraries/public/:id (ITN-21) */
export class PublicViewQueryDto {
  @ApiPropertyOptional({
    description: 'Currency for the budget totals. Default: your preferred currency (USD for guests)',
  })
  @IsOptional()
  @IsString()
  currency?: string;
}

/** GET /api/itineraries/:id/hotels (ITN-25) */
export class ItineraryHotelsQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    description: 'Which city group (groupNumber from the itinerary). Default: the first group',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  groupIndex?: number;

  @ApiPropertyOptional({ description: 'Or: any day of the group' })
  @IsOptional()
  @IsMongoId()
  dayId?: string;

  @ApiProperty({ example: 2, minimum: 1, description: 'Total number of guests' })
  @IsInt()
  @Min(1)
  guests: number;

  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: MAX_ROOMS_PER_BOOKING })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_ROOMS_PER_BOOKING)
  rooms: number = 1;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 10;
}

export const TRIP_TYPES = ['one_way', 'round_trip'] as const;

/** GET /api/itineraries/:id/flights (ITN-26) */
export class ItineraryFlightsQueryDto {
  @ApiProperty({ example: 'LHR', description: 'Origin airport IATA code (GET /api/airports)' })
  @Transform(upper)
  @Matches(/^[A-Z]{3}$/, { message: 'from must be a 3-letter airport code' })
  from: string;

  @ApiPropertyOptional({ enum: TRIP_TYPES, default: 'round_trip' })
  @IsOptional()
  @IsIn(TRIP_TYPES)
  tripType: (typeof TRIP_TYPES)[number] = 'round_trip';

  @ApiPropertyOptional({ description: "Default: the itinerary's start date" })
  @IsOptional()
  @Matches(DATE_REGEX, { message: 'departureDate must look like 2026-12-01' })
  departureDate?: string;

  @ApiPropertyOptional({ description: "Round trip only. Default: the last day's date" })
  @IsOptional()
  @Matches(DATE_REGEX, { message: 'returnDate must look like 2026-12-08' })
  returnDate?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 9 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(9)
  adults: number = 1;

  @ApiPropertyOptional({ default: 0, minimum: 0, maximum: 8 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(8)
  children: number = 0;

  @ApiPropertyOptional({ default: 0, minimum: 0, maximum: 9 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9)
  infants: number = 0;

  @ApiPropertyOptional({ enum: CabinClass, default: CabinClass.ECONOMY })
  @IsOptional()
  @IsEnum(CabinClass)
  cabinClass: CabinClass = CabinClass.ECONOMY;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 10;
}
