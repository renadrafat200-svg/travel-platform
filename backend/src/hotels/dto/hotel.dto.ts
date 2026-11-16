import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { MAX_ROOMS_PER_BOOKING } from '../hotel.constants';

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
/** "wifi, Pool" (query string) or ["wifi","Pool"] (body) -> ["wifi","pool"] */
export const lowerList = ({ value }: { value: unknown }) => {
  const list = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : value;
  return Array.isArray(list)
    ? [
        ...new Set(
          list.map((v) => String(v).trim().toLowerCase()).filter(Boolean),
        ),
      ]
    : list;
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DATE = /^\d{4}-\d{2}-\d{2}$/;

// ---------- policies (HTL-09, HTL-10) ----------

export class CancellationTierDto {
  @ApiProperty({
    example: 7,
    description: 'Cancel this many days or more before check-in...',
  })
  @IsInt()
  @Min(0)
  @Max(365)
  daysBeforeCheckIn: number;

  @ApiProperty({
    example: 100,
    description: '...and get this percentage of the total back',
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  refundPercent: number;
}

/** PUT /api/hotels/:id/policies */
export class HotelPoliciesDto {
  @ApiProperty({
    example: '15:00',
    description: 'Standard check-in time, local hotel time HH:mm',
  })
  @Matches(TIME, { message: 'checkInTime must look like 15:00' })
  checkInTime: string;

  @ApiProperty({
    example: '12:00',
    description: 'Standard check-out time, local hotel time HH:mm',
  })
  @Matches(TIME, { message: 'checkOutTime must look like 12:00' })
  checkOutTime: string;

  @ApiProperty({
    type: [CancellationTierDto],
    description:
      'Each daysBeforeCheckIn must be unique. No matching tier = 0% refund.',
    example: [
      { daysBeforeCheckIn: 7, refundPercent: 100 },
      { daysBeforeCheckIn: 2, refundPercent: 50 },
      { daysBeforeCheckIn: 0, refundPercent: 0 },
    ],
  })
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => CancellationTierDto)
  cancellationTiers: CancellationTierDto[];

  @ApiPropertyOptional({ example: 'A valid ID is required at check-in.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

// ---------- hotel profile (HTL-01, HTL-02) ----------

/** POST /api/hotels (admin only). Photos are uploaded afterwards with POST /api/hotels/:id/photos. */
export class CreateHotelDto {
  @ApiProperty({ example: 'Nile View Hotel' })
  @IsString()
  @Length(2, 120)
  name: string;

  @ApiProperty({ example: '12 Corniche El Nil, Garden City' })
  @IsString()
  @Length(3, 300)
  address: string;

  @ApiProperty({
    example: 'cairo',
    description:
      'City id from GET /api/cities. The country is taken from the city.',
  })
  @Transform(lower)
  @Matches(/^[a-z0-9_-]{2,60}$/, {
    message: 'city must be a city id like cairo',
  })
  city: string;

  @ApiPropertyOptional({
    example: 'A quiet hotel on the Nile, 10 minutes from downtown.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(3000)
  description?: string;

  @ApiProperty({
    example: 4,
    minimum: 1,
    maximum: 5,
    description: 'Star class',
  })
  @IsInt()
  @Min(1)
  @Max(5)
  starRating: number;

  @ApiPropertyOptional({ example: ['wifi', 'pool', 'parking'] })
  @IsOptional()
  @Transform(lowerList)
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  amenities?: string[];

  @ApiPropertyOptional({
    type: HotelPoliciesDto,
    description:
      'Defaults: check-in 15:00, check-out 12:00, refunds 100% (7+ days) / 50% (2+ days) / 0%',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => HotelPoliciesDto)
  policies?: HotelPoliciesDto;
}

/** PATCH /api/hotels/:id (this hotel's moderator or an admin). The city is fixed. */
export class UpdateHotelDto extends PartialType(
  OmitType(CreateHotelDto, ['city'] as const),
) {}

/** GET /api/hotels/:id: give both dates to also see the free rooms */
export class HotelDetailsQueryDto {
  @ApiPropertyOptional({
    description: 'With checkOut: also list the rooms free for these dates',
  })
  @IsOptional()
  @Matches(DATE, { message: 'checkIn must look like 2026-12-01' })
  checkIn?: string;

  @ApiPropertyOptional({ description: 'Day you leave (not a night)' })
  @IsOptional()
  @Matches(DATE, { message: 'checkOut must look like 2026-12-04' })
  checkOut?: string;
}

/** GET /api/hotels filters */
export class HotelQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'City id' })
  @IsOptional()
  @Transform(lower)
  @IsString()
  city?: string;

  @ApiPropertyOptional({ description: 'Country code' })
  @IsOptional()
  @Transform(upper)
  @IsString()
  country?: string;

  @ApiPropertyOptional({ description: 'Search by name or address' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    description: 'Admins only: also list deactivated hotels',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeInactive?: boolean;
}

// ---------- search (HTL-11, HTL-12) ----------

export const HOTEL_SORT_FIELDS = ['price', 'rating'] as const;

/** GET /api/hotels/search (public) */
export class HotelSearchDto {
  @ApiPropertyOptional({
    description: 'City id from GET /api/cities (give city or country)',
  })
  @IsOptional()
  @Transform(lower)
  @IsString()
  @Length(2, 60)
  city?: string;

  @ApiPropertyOptional({
    description: 'Country code from GET /api/countries (give city or country)',
  })
  @IsOptional()
  @Transform(upper)
  @Matches(/^[A-Z]{2}$/, {
    message: 'country must be a 2-letter country code like EG',
  })
  country?: string;

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
    example: 2,
    minimum: 1,
    description: 'Total number of guests (adults + children)',
  })
  @IsInt()
  @Min(1)
  @Max(100)
  guests: number;

  @ApiPropertyOptional({
    default: 1,
    minimum: 1,
    maximum: MAX_ROOMS_PER_BOOKING,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_ROOMS_PER_BOOKING)
  rooms: number = 1;

  @ApiPropertyOptional({
    description: 'Lowest price per night (USD) of the cheapest qualifying room',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({
    description:
      'Highest price per night (USD) of the cheapest qualifying room',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 5,
    description: 'Minimum average rating; unrated hotels are excluded when set',
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(5)
  minRating?: number;

  @ApiPropertyOptional({ enum: HOTEL_SORT_FIELDS, default: 'price' })
  @IsOptional()
  @IsIn(HOTEL_SORT_FIELDS)
  sortBy: (typeof HOTEL_SORT_FIELDS)[number] = 'price';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order: 'asc' | 'desc' = 'asc';

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

/** GET /api/hotels/:id/rooms/available (HTL-15) */
export class AvailableRoomsQueryDto {
  @ApiProperty({ example: '2026-12-01' })
  @Matches(DATE, { message: 'checkIn must look like 2026-12-01' })
  checkIn: string;

  @ApiProperty({
    example: '2026-12-04',
    description: 'Day you leave (not a night)',
  })
  @Matches(DATE, { message: 'checkOut must look like 2026-12-04' })
  checkOut: string;
}
