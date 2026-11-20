import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { RoomType } from '../schemas/room.schema';
import { DATE, lowerList } from './hotel.dto';

/** POST /api/hotels/:hotelId/rooms (HTL-03) */
export class CreateRoomDto {
  @ApiProperty({
    example: '204',
    description: 'Room number or name, unique in the hotel',
  })
  @IsString()
  @Length(1, 50)
  roomNumber: string;

  @ApiProperty({ enum: RoomType, example: RoomType.DOUBLE })
  @IsEnum(RoomType)
  type: RoomType;

  @ApiPropertyOptional({ example: 'King bed, balcony facing the Nile.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({
    example: 1,
    minimum: 1,
    maximum: 10,
    description: 'Number of beds',
  })
  @IsInt()
  @Min(1)
  @Max(10)
  beds: number;

  @ApiProperty({
    example: 2,
    minimum: 1,
    maximum: 20,
    description: 'Most guests (adults + children)',
  })
  @IsInt()
  @Min(1)
  @Max(20)
  maxOccupancy: number;

  @ApiProperty({
    example: 120,
    description: 'Price per night in USD, more than 0',
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01, { message: 'pricePerNight must be more than 0' })
  pricePerNight: number;

  @ApiPropertyOptional({ example: ['air conditioning', 'minibar'] })
  @IsOptional()
  @Transform(lowerList)
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  amenities?: string[];
}

/** PATCH /api/hotels/:hotelId/rooms/:roomId (HTL-05). New prices only apply to new reservations. */
export class UpdateRoomDto extends PartialType(CreateRoomDto) {}

/** GET /api/hotels/:hotelId/rooms */
export class RoomListQueryDto {
  @ApiPropertyOptional({
    description: 'Moderators/admins only: also list deactivated rooms',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeInactive?: boolean;
}

/** A date range of nights: from = first night, to = first night NOT included */
export class DateRangeDto {
  @ApiProperty({
    example: '2026-12-01',
    description: 'First night (hotel local date)',
  })
  @Matches(DATE, { message: 'from must look like 2026-12-01' })
  from: string;

  @ApiProperty({
    example: '2027-03-01',
    description: 'First night NOT included',
  })
  @Matches(DATE, { message: 'to must look like 2027-03-01' })
  to: string;
}

/** POST /api/hotels/:hotelId/rooms/:roomId/blocks (HTL-06) */
export class CreateRoomBlockDto extends DateRangeDto {
  @ApiPropertyOptional({ example: 'Bathroom renovation' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

/** GET /api/hotels/:hotelId/rooms/:roomId/calendar (HTL-08) */
export class RoomCalendarQueryDto {
  @ApiProperty({ example: '2026-12-01' })
  @Matches(DATE, { message: 'from must look like 2026-12-01' })
  from: string;

  @ApiProperty({ example: '2026-12-31', description: 'Not included' })
  @Matches(DATE, { message: 'to must look like 2026-12-31' })
  to: string;
}
