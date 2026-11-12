import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsDefined,
    IsEnum,
    IsInt,
    IsMongoId,
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
import { CabinClass } from '../../flights/schemas/flight.schema';
import { MAX_EXTRA_BAGS, MAX_PASSENGERS } from '../flight-booking.constants';
import { BookingStatus } from '../schemas/flight-booking.schema';

/** Which flight and which cabin */
export class LegSelectionDto {
    @ApiProperty({ example: '6a0f1c2d3e4f5a6b7c8d9e0f', description: 'Flight id from flight search' })
    @IsMongoId()
    flightId: string;

    @ApiProperty({ enum: CabinClass, example: CabinClass.ECONOMY })
    @IsEnum(CabinClass)
    cabinClass: CabinClass;
}

/** POST /api/flight-bookings/hold (FLT-22): step 1, hold the seats */
export class HoldFlightDto {
    @ApiProperty({ type: LegSelectionDto })
    @IsDefined()
    @ValidateNested()
    @Type(() => LegSelectionDto)
    outbound: LegSelectionDto;

    @ApiPropertyOptional({
        type: LegSelectionDto,
        description: 'Only for a round trip: the flight back',
    })
    @IsOptional()
    @ValidateNested()
    @Type(() => LegSelectionDto)
    returnFlight?: LegSelectionDto;

    @ApiProperty({
        example: 2,
        minimum: 1,
        maximum: MAX_PASSENGERS,
        description: '12 years or older',
    })
    @IsInt()
    @Min(1)
    @Max(MAX_PASSENGERS)
    adults: number;

    @ApiPropertyOptional({ example: 1, minimum: 0, default: 0, description: '2 to 11 years' })
    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(MAX_PASSENGERS)
    children?: number;

    @ApiPropertyOptional({
        example: 0,
        minimum: 0,
        default: 0,
        description: 'Under 2 years, on an adult’s lap (no seat)',
    })
    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(MAX_PASSENGERS)
    infants?: number;
}

export class PassengerDto {
    @ApiProperty({ example: 'Malak' })
    @IsString()
    @Length(1, 50)
    firstName: string;

    @ApiProperty({ example: 'Ehab' })
    @IsString()
    @Length(1, 50)
    lastName: string;

    @ApiProperty({
        example: '2004-05-17',
        description: 'Decides adult / child / infant on the day of the outbound flight',
    })
    @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dateOfBirth must look like 2004-05-17' })
    dateOfBirth: string;

    @ApiPropertyOptional({ example: 1, minimum: 0, maximum: MAX_EXTRA_BAGS, default: 0 })
    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(MAX_EXTRA_BAGS)
    extraBags?: number;
}

/** POST /api/flight-bookings (FLT-19, FLT-21): step 2, passenger details and extra baggage */
export class CreateFlightBookingDto {
    @ApiProperty({
        example: '6a0f1c2d3e4f5a6b7c8d9e0f',
        description: 'The id returned by POST /hold',
    })
    @IsMongoId()
    holdId: string;

    @ApiProperty({ type: [PassengerDto] })
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(MAX_PASSENGERS)
    @ValidateNested({ each: true })
    @Type(() => PassengerDto)
    passengers: PassengerDto[];
}

/** GET /api/flight-bookings (FLT-25) */
export class MyFlightBookingsQueryDto extends PaginationQueryDto {
    @ApiPropertyOptional({ enum: BookingStatus })
    @IsOptional()
    @IsEnum(BookingStatus)
    status?: BookingStatus;
}

/** GET /api/flights/:id/bookings (FLT-29) */
export class FlightBookingsQueryDto extends PaginationQueryDto {
    @ApiPropertyOptional({ enum: BookingStatus })
    @IsOptional()
    @IsEnum(BookingStatus)
    status?: BookingStatus;
}

/** POST /api/flight-bookings/:id/cancel (FLT-26) */
export class CancelFlightBookingDto {
    @ApiPropertyOptional({ example: 'Change of plans' })
    @IsOptional()
    @IsString()
    @MaxLength(500)
    reason?: string;
}