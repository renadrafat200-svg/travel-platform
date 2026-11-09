import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsEnum,
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CabinClass, FlightStatus } from '../schemas/flight.schema';

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

const LOCAL_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const LOCAL_TIME_MSG = 'must be a local time like 2026-12-01T09:30 (airport local time, no Z)';

// ---------- cabins ----------

export class CabinPricesDto {
  @ApiProperty({ example: 300, description: 'Price for one adult' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  adult: number;

  @ApiPropertyOptional({ example: 225, description: 'Defaults to 75% of the adult price' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  child?: number;

  @ApiPropertyOptional({ example: 30, description: 'Defaults to 10% of the adult price' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  infant?: number;
}

/** POST /api/flights/:id/cabins (FLT-04) */
export class CreateCabinDto {
  @ApiProperty({ enum: CabinClass, example: CabinClass.ECONOMY })
  @IsEnum(CabinClass)
  cabinClass: CabinClass;

  @ApiProperty({ example: 150, minimum: 1, maximum: 1000 })
  @IsInt()
  @Min(1)
  @Max(1000)
  totalSeats: number;

  @ApiProperty({ type: CabinPricesDto })
  @ValidateNested()
  @Type(() => CabinPricesDto)
  prices: CabinPricesDto;
}

/** PATCH /api/flights/:id/cabins/:cabinId (FLT-04, FLT-05) */
export class UpdateCabinDto {
  @ApiPropertyOptional({
    example: 160,
    description: 'Cannot go below the number of seats already held or sold',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  totalSeats?: number;

  @ApiPropertyOptional({ type: CabinPricesDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CabinPricesDto)
  prices?: CabinPricesDto;
}

// ---------- flights ----------

/** POST /api/flights (FLT-03) */
export class CreateFlightDto {
  @ApiPropertyOptional({
    example: '6a0eb842da554c99a192cf0b',
    description: 'Admins only. Airline moderators always create flights for their own airline.',
  })
  @IsOptional()
  @IsMongoId()
  airlineId?: string;

  @ApiProperty({ example: 'MS777' })
  @Transform(upper)
  @Matches(/^[A-Z0-9]{2}\d{1,4}[A-Z]?$/, { message: 'flightNumber must look like MS777' })
  flightNumber: string;

  @ApiProperty({ example: 'CAI', description: 'IATA code from GET /api/airports' })
  @Transform(upper)
  @Matches(/^[A-Z]{3}$/, { message: 'origin must be a 3-letter airport code' })
  origin: string;

  @ApiProperty({ example: 'DXB' })
  @Transform(upper)
  @Matches(/^[A-Z]{3}$/, { message: 'destination must be a 3-letter airport code' })
  destination: string;

  @ApiProperty({ example: '2026-12-01T09:30', description: 'Local time at the departure airport' })
  @Matches(LOCAL_TIME, { message: `departureLocal ${LOCAL_TIME_MSG}` })
  departureLocal: string;

  @ApiProperty({ example: '2026-12-01T14:45', description: 'Local time at the arrival airport' })
  @Matches(LOCAL_TIME, { message: `arrivalLocal ${LOCAL_TIME_MSG}` })
  arrivalLocal: string;

  @ApiPropertyOptional({ example: 'USD', description: 'Defaults to the airline baggage currency' })
  @IsOptional()
  @Transform(upper)
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @ApiPropertyOptional({
    type: [CreateCabinDto],
    description: 'Optional: cabins can also be added later with POST /api/flights/:id/cabins',
  })
  @IsOptional()
  @ValidateNested({ each: true })
  @ArrayMaxSize(4)
  @Type(() => CreateCabinDto)
  cabins?: CreateCabinDto[];
}

/** PATCH /api/flights/:id (FLT-05): schedule changes */
export class UpdateFlightDto {
  @ApiPropertyOptional({ example: 'MS779' })
  @IsOptional()
  @Transform(upper)
  @Matches(/^[A-Z0-9]{2}\d{1,4}[A-Z]?$/, { message: 'flightNumber must look like MS777' })
  flightNumber?: string;

  @ApiPropertyOptional({ example: '2026-12-01T10:15', description: 'New local departure time' })
  @IsOptional()
  @Matches(LOCAL_TIME, { message: `departureLocal ${LOCAL_TIME_MSG}` })
  departureLocal?: string;

  @ApiPropertyOptional({ example: '2026-12-01T15:30', description: 'New local arrival time' })
  @IsOptional()
  @Matches(LOCAL_TIME, { message: `arrivalLocal ${LOCAL_TIME_MSG}` })
  arrivalLocal?: string;
}

/** POST /api/flights/:id/cancel (FLT-06) */
export class CancelFlightDto {
  @ApiPropertyOptional({ example: 'Aircraft maintenance' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/** GET /api/flights/mine: the moderator's own flights */
export class MyFlightsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: FlightStatus })
  @IsOptional()
  @IsEnum(FlightStatus)
  status?: FlightStatus;

  @ApiPropertyOptional({ example: 'MS777' })
  @IsOptional()
  @Transform(upper)
  @IsString()
  @MaxLength(10)
  flightNumber?: string;

  @ApiPropertyOptional({ description: 'Admins only: whose flights to list' })
  @IsOptional()
  @IsMongoId()
  airlineId?: string;
}
