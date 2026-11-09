import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsBoolean,
  IsEmail,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

// ---------- policies ----------

export class BagAllowanceDto {
  @ApiProperty({ example: 1, minimum: 0, maximum: 10 })
  @IsInt()
  @Min(0)
  @Max(10)
  pieces: number;

  @ApiProperty({ example: 7, minimum: 0, maximum: 100 })
  @IsNumber()
  @Min(0)
  @Max(100)
  maxWeightKg: number;
}

/** PUT /api/airlines/:id/baggage-policy */
export class BaggagePolicyDto {
  @ApiProperty({
    type: BagAllowanceDto,
    example: { pieces: 1, maxWeightKg: 7 },
  })
  @ValidateNested()
  @Type(() => BagAllowanceDto)
  cabin: BagAllowanceDto;

  @ApiProperty({
    type: BagAllowanceDto,
    example: { pieces: 1, maxWeightKg: 23 },
  })
  @ValidateNested()
  @Type(() => BagAllowanceDto)
  checked: BagAllowanceDto;

  @ApiProperty({ example: 50, description: 'Price of one extra checked bag' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  extraBagFee: number;

  @ApiProperty({
    example: 'USD',
    description: 'A currency from GET /api/currencies',
  })
  @Transform(upper)
  @Matches(/^[A-Z]{3}$/, {
    message: 'currency must be a 3-letter code like USD',
  })
  currency: string;

  @ApiPropertyOptional({
    example: 'Sports equipment counts as one checked bag.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class CancellationRuleDto {
  @ApiProperty({
    example: 72,
    description: 'Cancel at least this many hours before departure...',
  })
  @IsInt()
  @Min(0)
  @Max(8760)
  hoursBeforeDeparture: number;

  @ApiProperty({
    example: 100,
    description: '...and get this percentage of the price back',
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  refundPercent: number;
}

/** PUT /api/airlines/:id/cancellation-policy */
export class CancellationPolicyDto {
  @ApiProperty({
    type: [CancellationRuleDto],
    example: [
      { hoursBeforeDeparture: 72, refundPercent: 100 },
      { hoursBeforeDeparture: 24, refundPercent: 50 },
      { hoursBeforeDeparture: 0, refundPercent: 0 },
    ],
  })
  @ValidateNested({ each: true })
  @ArrayMaxSize(10)
  @Type(() => CancellationRuleDto)
  rules: CancellationRuleDto[];

  @ApiPropertyOptional({
    example: 'Refunds go back to the original card within 7 days.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

// ---------- airline profile ----------

/** POST /api/airlines (admin only) */
export class CreateAirlineDto {
  @ApiProperty({ example: 'EgyptAir' })
  @IsString()
  @Length(2, 100)
  name: string;

  @ApiProperty({ example: 'MS', description: '2-character IATA airline code' })
  @Transform(upper)
  @Matches(/^[A-Z0-9]{2}$/, {
    message: 'iataCode must be 2 letters or digits, e.g. MS',
  })
  iataCode: string;

  @ApiProperty({
    example: 'EG',
    description: 'Country code from GET /api/countries',
  })
  @Transform(upper)
  @Matches(/^[A-Z]{2}$/, {
    message: 'country must be a 2-letter country code like EG',
  })
  country: string;

  @ApiPropertyOptional({ example: 'The national airline of Egypt.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ example: 'https://example.com/egyptair-logo.png' })
  @IsOptional()
  @IsUrl()
  logoUrl?: string;

  @ApiPropertyOptional({ example: 'support@egyptair.example' })
  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @ApiPropertyOptional({ example: '+20 2 1234 5678' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  contactPhone?: string;

  @ApiPropertyOptional({ example: 'https://www.egyptair.example' })
  @IsOptional()
  @IsUrl()
  website?: string;

  @ApiPropertyOptional({
    type: BaggagePolicyDto,
    description: 'Defaults to 1×7 kg cabin, 1×23 kg checked',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => BaggagePolicyDto)
  baggagePolicy?: BaggagePolicyDto;

  @ApiPropertyOptional({
    type: CancellationPolicyDto,
    description: 'Defaults to 100% / 50% / 0%',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CancellationPolicyDto)
  cancellationPolicy?: CancellationPolicyDto;
}

/** PATCH /api/airlines/:id (admin or that airline's moderator). The IATA code cannot change. */
export class UpdateAirlineDto extends PartialType(
  OmitType(CreateAirlineDto, ['iataCode', 'baggagePolicy', 'cancellationPolicy'] as const),
) {}

/** GET /api/airlines filters */
export class AirlineQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Search by name or IATA code',
    example: 'egypt',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ example: 'EG' })
  @IsOptional()
  @Transform(upper)
  @Matches(/^[A-Z]{2}$/)
  country?: string;

  @ApiPropertyOptional({
    description: 'Admins only: also list deactivated airlines',
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeInactive?: boolean;
}
