import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { CabinClass } from '../schemas/flight.schema';

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export const FLIGHT_SORT_FIELDS = ['price', 'departureTime', 'arrivalTime', 'duration'] as const;

/** GET /api/flights/search (FLT-11, FLT-12, FLT-15) */
export class FlightSearchDto {
  @ApiProperty({ example: 'CAI', description: 'Departure airport IATA code' })
  @Transform(upper)
  @Matches(/^[A-Z]{3}$/, { message: 'from must be a 3-letter airport code' })
  from: string;

  @ApiProperty({ example: 'DXB', description: 'Arrival airport IATA code' })
  @Transform(upper)
  @Matches(/^[A-Z]{3}$/, { message: 'to must be a 3-letter airport code' })
  to: string;

  @ApiProperty({ example: '2026-12-01', description: 'Local date at the departure airport' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'departureDate must look like 2026-12-01' })
  departureDate: string;

  @ApiPropertyOptional({
    example: '2026-12-08',
    description: 'Give a return date for a round trip; leave empty for one-way',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'returnDate must look like 2026-12-08' })
  returnDate?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 9 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(9)
  adults: number = 1;

  @ApiPropertyOptional({ default: 0, minimum: 0, maximum: 8, description: 'Ages 2-11, use a seat' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(8)
  children: number = 0;

  @ApiPropertyOptional({
    default: 0,
    minimum: 0,
    maximum: 9,
    description: 'Under 2, sit on an adult’s lap (at most one per adult)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9)
  infants: number = 0;

  @ApiPropertyOptional({ enum: CabinClass, default: CabinClass.ECONOMY })
  @IsOptional()
  @IsEnum(CabinClass)
  cabinClass: CabinClass = CabinClass.ECONOMY;

  @ApiPropertyOptional({ example: 200, description: 'Minimum total price for all passengers' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({ example: 1500, description: 'Maximum total price for all passengers' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional({ description: 'Only this airline' })
  @IsOptional()
  @IsMongoId()
  airlineId?: string;

  @ApiPropertyOptional({ enum: FLIGHT_SORT_FIELDS, default: 'price' })
  @IsOptional()
  @IsIn(FLIGHT_SORT_FIELDS)
  sortBy: (typeof FLIGHT_SORT_FIELDS)[number] = 'price';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order: 'asc' | 'desc' = 'asc';

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
