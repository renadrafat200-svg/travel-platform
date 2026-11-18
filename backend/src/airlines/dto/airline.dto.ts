import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
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

/** PUT /api/airlines/:id/baggage-policy (FLT-08). Free allowance is set per cabin on each flight. */
export class BaggagePolicyDto {
  @ApiProperty({
    example: 50,
    description: 'Price of one extra bag in USD (> 0)',
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01, { message: 'extraBagPrice must be greater than 0' })
  @Max(10000)
  extraBagPrice: number;

  @ApiProperty({
    example: 3,
    minimum: 0,
    maximum: 10,
    description: 'Most extra bags one passenger can add (0 = none sold)',
  })
  @IsInt()
  @Min(0)
  @Max(10)
  maxExtraBags: number;

  @ApiPropertyOptional({
    example: "Each extra bag has the same max weight as the cabin's free bags.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class CancellationRuleDto {
  @ApiProperty({
    example: 7,
    description: 'Cancel at least this many whole days before departure...',
  })
  @IsInt({ message: 'daysBeforeDeparture must be a whole number' })
  @Min(0)
  @Max(365)
  daysBeforeDeparture: number;

  @ApiProperty({
    example: 100,
    description: '...and get this percentage of the price back (0-100)',
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
      { daysBeforeDeparture: 7, refundPercent: 100 },
      { daysBeforeDeparture: 2, refundPercent: 50 },
      { daysBeforeDeparture: 0, refundPercent: 0 },
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
    description: 'Defaults to 50 USD per extra bag, max 3 per passenger',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => BaggagePolicyDto)
  baggagePolicy?: BaggagePolicyDto;

  @ApiPropertyOptional({
    type: CancellationPolicyDto,
    description: 'Defaults to 100% (7+ days) / 50% (2+ days) / 0%',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CancellationPolicyDto)
  cancellationPolicy?: CancellationPolicyDto;
}

/** PATCH /api/airlines/:id (admin or that airline's moderator). The IATA code cannot change. */
export class UpdateAirlineDto extends PartialType(
  OmitType(CreateAirlineDto, [
    'iataCode',
    'baggagePolicy',
    'cancellationPolicy',
  ] as const),
) {}

/** GET /api/airlines filters */
export class AirlineQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Search by name or IATA code',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ description: 'Country code, e.g. EG' })
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
