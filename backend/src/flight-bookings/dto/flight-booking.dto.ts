import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
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
    @ApiProperty({
        example: '6a0f1c2d3e4f5a6b7c8d9e0f',
        description: 'Flight id from flight search',
    })
    @IsMongoId()
    flightId: string;

    @ApiProperty({ enum: CabinClass, example: CabinClass.ECONOMY })
    @IsEnum(CabinClass)
    cabinClass: CabinClass;
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
    @Matches(/^\d{4}-\d{2}-\d{2}$/, {
        message: 'dateOfBirth must look like 2004-05-17',
    })
    dateOfBirth: string;

    @ApiPropertyOptional({
        example: 1,
        minimum: 0,
        maximum: MAX_EXTRA_BAGS,
        default: 0,
    })
    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(MAX_EXTRA_BAGS)
    extraBags?: number;
}

/** POST /api/flight-bookings */
export class CreateFlightBookingDto {
    @ApiProperty({ type: LegSelectionDto })
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

    @ApiProperty({ type: [PassengerDto] })
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(MAX_PASSENGERS)
    @ValidateNested({ each: true })
    @Type(() => PassengerDto)
    passengers: PassengerDto[];
}

/** GET /api/flight-bookings/mine */
export class MyFlightBookingsQueryDto extends PaginationQueryDto {
    @ApiPropertyOptional({ enum: BookingStatus })
    @IsOptional()
    @IsEnum(BookingStatus)
    status?: BookingStatus;
}

/** PATCH /api/flight-bookings/:id/cancel */
export class CancelFlightBookingDto {
    @ApiPropertyOptional({ example: 'Change of plans' })
    @IsOptional()
    @IsString()
    @MaxLength(500)
    reason?: string;
}