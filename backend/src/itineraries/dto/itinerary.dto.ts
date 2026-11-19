import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import {
  DATE_REGEX,
  DAY_NOTES_MAX_LENGTH,
  MAX_COUNTRIES,
  MAX_DAYS,
  TITLE_MAX_LENGTH,
  Visibility,
} from '../itinerary.constants';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
const upperList = ({ value }: { value: unknown }) =>
  Array.isArray(value)
    ? value.map((v) => (typeof v === 'string' ? v.trim().toUpperCase() : v))
    : value;

/** POST /api/itineraries (ITN-01) */
export class CreateItineraryDto {
  @ApiProperty({ example: 'Two weeks in Egypt', maxLength: TITLE_MAX_LENGTH })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'title is required' })
  @MaxLength(TITLE_MAX_LENGTH)
  title: string;

  @ApiProperty({
    example: ['EG'],
    description: 'One or more country codes from GET /api/countries',
  })
  @Transform(upperList)
  @IsArray()
  @ArrayMinSize(1, { message: 'Pick at least one country' })
  @ArrayMaxSize(MAX_COUNTRIES)
  @IsString({ each: true })
  countries: string[];

  @ApiProperty({ example: '2026-12-01', description: 'Date of day 1' })
  @Matches(DATE_REGEX, { message: 'startDate must look like 2026-12-01' })
  startDate: string;
}

/** PATCH /api/itineraries/:id (ITN-01, ITN-20). Send only what changes. */
export class UpdateItineraryDto {
  @ApiPropertyOptional({ maxLength: TITLE_MAX_LENGTH })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'title cannot be empty' })
  @MaxLength(TITLE_MAX_LENGTH)
  title?: string;

  @ApiPropertyOptional({ type: [String], description: 'Country codes' })
  @IsOptional()
  @Transform(upperList)
  @IsArray()
  @ArrayMinSize(1, { message: 'Pick at least one country' })
  @ArrayMaxSize(MAX_COUNTRIES)
  @IsString({ each: true })
  countries?: string[];

  @ApiPropertyOptional({ description: 'New date of day 1, e.g. 2026-12-05' })
  @IsOptional()
  @Matches(DATE_REGEX, { message: 'startDate must look like 2026-12-01' })
  startDate?: string;

  @ApiPropertyOptional({
    enum: Visibility,
    description:
      'public = shown in the shared search, read-only to others (ITN-20)',
  })
  @IsOptional()
  @IsEnum(Visibility)
  visibility?: Visibility;
}

/** POST /api/itineraries/:id/days (ITN-05) */
export class AddDayDto {
  @ApiProperty({ example: 'cairo', description: 'City id from GET /api/cities' })
  @Transform(lower)
  @IsString()
  @IsNotEmpty({ message: 'Every day needs a city' })
  city: string;

  @ApiPropertyOptional({ maxLength: DAY_NOTES_MAX_LENGTH })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(DAY_NOTES_MAX_LENGTH)
  notes?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_DAYS,
    description: 'Insert as this day number; leave empty to add at the end',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  position?: number;
}

/** PATCH /api/itineraries/:id/days/:dayId (ITN-05) */
export class UpdateDayDto {
  @ApiPropertyOptional({ description: 'City id from GET /api/cities' })
  @IsOptional()
  @Transform(lower)
  @IsString()
  @IsNotEmpty({ message: 'Every day needs a city' })
  city?: string;

  @ApiPropertyOptional({ maxLength: DAY_NOTES_MAX_LENGTH })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(DAY_NOTES_MAX_LENGTH)
  notes?: string;
}

/** PATCH /api/itineraries/:id/days/reorder (ITN-08) */
export class ReorderDayDto {
  @ApiProperty({ description: 'Id of the day to move' })
  @IsMongoId()
  dayId: string;

  @ApiProperty({
    example: 1,
    minimum: 1,
    description: 'New day number for it (1 = first day)',
  })
  @IsInt()
  @Min(1)
  position: number;
}
