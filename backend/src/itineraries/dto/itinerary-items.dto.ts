import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  ACTIVITY_DESCRIPTION_MAX_LENGTH,
  ACTIVITY_NAME_MAX_LENGTH,
  BudgetCategory,
  CURRENCY_REGEX,
  MAX_AMOUNT,
  NOTE_MAX_LENGTH,
  TIME_REGEX,
  TransportMode,
} from '../itinerary.constants';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

const CURRENCY_MESSAGE =
  'currency must be a 3-letter code from GET /api/currencies, e.g. EGP';

// ---------------------------------------------------------------- Activities (ITN-10)

export class CreateActivityDto {
  @ApiProperty({ example: 'Visit the Pyramids of Giza', maxLength: ACTIVITY_NAME_MAX_LENGTH })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'name is required' })
  @MaxLength(ACTIVITY_NAME_MAX_LENGTH)
  name: string;

  @ApiPropertyOptional({ maxLength: ACTIVITY_DESCRIPTION_MAX_LENGTH })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(ACTIVITY_DESCRIPTION_MAX_LENGTH)
  description?: string;

  @ApiPropertyOptional({ example: '09:30', description: 'Optional time, 24h HH:mm' })
  @IsOptional()
  @Matches(TIME_REGEX, { message: 'time must look like 09:30' })
  time?: string;

  @ApiPropertyOptional({ example: 25, minimum: 0, description: 'Optional cost' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'cost cannot be negative' })
  @Max(MAX_AMOUNT)
  cost?: number;

  @ApiPropertyOptional({
    example: 'EGP',
    description: "Currency of the cost (defaults to your preferred currency)",
  })
  @IsOptional()
  @Transform(upper)
  @Matches(CURRENCY_REGEX, { message: CURRENCY_MESSAGE })
  currency?: string;
}

/** PATCH /api/activities/:id. Send null for time or cost to clear them. */
export class UpdateActivityDto {
  @ApiPropertyOptional({ maxLength: ACTIVITY_NAME_MAX_LENGTH })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'name cannot be empty' })
  @MaxLength(ACTIVITY_NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({ maxLength: ACTIVITY_DESCRIPTION_MAX_LENGTH })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(ACTIVITY_DESCRIPTION_MAX_LENGTH)
  description?: string;

  @ApiPropertyOptional({ nullable: true, description: 'HH:mm, or null to clear' })
  @ValidateIf((_, v) => v !== undefined && v !== null)
  @Matches(TIME_REGEX, { message: 'time must look like 09:30' })
  time?: string | null;

  @ApiPropertyOptional({ nullable: true, minimum: 0, description: 'or null to clear' })
  @ValidateIf((_, v) => v !== undefined && v !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'cost cannot be negative' })
  @Max(MAX_AMOUNT)
  cost?: number | null;

  @ApiPropertyOptional({ example: 'EGP' })
  @IsOptional()
  @Transform(upper)
  @Matches(CURRENCY_REGEX, { message: CURRENCY_MESSAGE })
  currency?: string;
}

// ---------------------------------------------------------------- Budgets (ITN-14)

export class CreateBudgetDto {
  @ApiProperty({ enum: BudgetCategory, example: BudgetCategory.FOOD })
  @IsEnum(BudgetCategory)
  category: BudgetCategory;

  @ApiProperty({ example: 300, minimum: 0 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'amount cannot be negative' })
  @Max(MAX_AMOUNT)
  amount: number;

  @ApiProperty({ example: 'EGP', description: 'From GET /api/currencies' })
  @Transform(upper)
  @Matches(CURRENCY_REGEX, { message: CURRENCY_MESSAGE })
  currency: string;

  @ApiPropertyOptional({ maxLength: NOTE_MAX_LENGTH, example: 'Lunch and dinner' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(NOTE_MAX_LENGTH)
  note?: string;
}

export class UpdateBudgetDto {
  @ApiPropertyOptional({ enum: BudgetCategory })
  @IsOptional()
  @IsEnum(BudgetCategory)
  category?: BudgetCategory;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'amount cannot be negative' })
  @Max(MAX_AMOUNT)
  amount?: number;

  @ApiPropertyOptional({ example: 'USD' })
  @IsOptional()
  @Transform(upper)
  @Matches(CURRENCY_REGEX, { message: CURRENCY_MESSAGE })
  currency?: string;

  @ApiPropertyOptional({ maxLength: NOTE_MAX_LENGTH })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(NOTE_MAX_LENGTH)
  note?: string;
}

// ---------------------------------------------------------------- Transport costs (ITN-16)

export class CreateTransportCostDto {
  @ApiProperty({ enum: TransportMode, example: TransportMode.FLIGHT })
  @IsEnum(TransportMode)
  mode: TransportMode;

  @ApiProperty({ example: 'cairo', description: 'City id from GET /api/cities' })
  @Transform(lower)
  @IsString()
  @IsNotEmpty()
  fromCity: string;

  @ApiProperty({ example: 'dubai', description: 'City id from GET /api/cities' })
  @Transform(lower)
  @IsString()
  @IsNotEmpty()
  toCity: string;

  @ApiProperty({ example: 150, minimum: 0 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'amount cannot be negative' })
  @Max(MAX_AMOUNT)
  amount: number;

  @ApiProperty({ example: 'USD' })
  @Transform(upper)
  @Matches(CURRENCY_REGEX, { message: CURRENCY_MESSAGE })
  currency: string;

  @ApiProperty({ description: 'Id of the day this cost is counted on' })
  @IsMongoId({ message: 'dayId must be the id of a day of this itinerary' })
  dayId: string;

  @ApiPropertyOptional({ maxLength: NOTE_MAX_LENGTH })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(NOTE_MAX_LENGTH)
  note?: string;
}

export class UpdateTransportCostDto {
  @ApiPropertyOptional({ enum: TransportMode })
  @IsOptional()
  @IsEnum(TransportMode)
  mode?: TransportMode;

  @ApiPropertyOptional({ description: 'City id' })
  @IsOptional()
  @Transform(lower)
  @IsString()
  @IsNotEmpty()
  fromCity?: string;

  @ApiPropertyOptional({ description: 'City id' })
  @IsOptional()
  @Transform(lower)
  @IsString()
  @IsNotEmpty()
  toCity?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'amount cannot be negative' })
  @Max(MAX_AMOUNT)
  amount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(upper)
  @Matches(CURRENCY_REGEX, { message: CURRENCY_MESSAGE })
  currency?: string;

  @ApiPropertyOptional({ description: 'Move it to another day of the itinerary' })
  @IsOptional()
  @IsMongoId({ message: 'dayId must be the id of a day of this itinerary' })
  dayId?: string;

  @ApiPropertyOptional({ maxLength: NOTE_MAX_LENGTH })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(NOTE_MAX_LENGTH)
  note?: string;
}
