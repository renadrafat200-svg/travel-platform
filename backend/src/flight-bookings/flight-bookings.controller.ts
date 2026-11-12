import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import {
    ApiBadRequestResponse,
    ApiConflictResponse,
    ApiCookieAuth,
    ApiCreatedResponse,
    ApiForbiddenResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiProduces,
    ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import {
    CancelFlightBookingDto,
    CreateFlightBookingDto,
    FlightBookingsQueryDto,
    HoldFlightDto,
    MyFlightBookingsQueryDto,
} from './dto/flight-booking.dto';
import { FlightBookingsService } from './flight-bookings.service';

/** Endpoints exactly as in section 8.4 of the project description */
@ApiTags('Flight bookings')
@ApiCookieAuth('access_token')
@Controller('flight-bookings')
export class FlightBookingsController {
    constructor(private readonly bookings: FlightBookingsService) { }

    @Post('hold')
    @Roles(Role.USER)
    @ApiOperation({
        summary: 'Step 1: hold seats on a one-way or round-trip flight while you book (FLT-22)',
    })
    @ApiCreatedResponse({ description: 'Pending booking (the hold) with holdExpiresAt and fares' })
    @ApiBadRequestResponse({ description: 'Cancelled flight, booking closed, wrong counts' })
    @ApiConflictResponse({ description: 'Not enough seats, or too many unpaid bookings' })
    @ApiNotFoundResponse({ description: 'Flight not found' })
    hold(@CurrentUser() user: AuthUser, @Body() dto: HoldFlightDto) {
        return this.bookings.hold(user, dto);
    }

    @Post()
    @HttpCode(200)
    @Roles(Role.USER)
    @ApiOperation({
        summary: 'Step 2: passenger details and extra baggage for a hold (FLT-19, FLT-21)',
    })
    @ApiOkResponse({ description: 'Booking with passengers, bag fees and the final total' })
    @ApiBadRequestResponse({ description: 'Passengers do not match the hold, or hold not pending' })
    @ApiConflictResponse({ description: 'The hold expired' })
    @ApiForbiddenResponse({ description: 'Not your hold' })
    addDetails(@CurrentUser() user: AuthUser, @Body() dto: CreateFlightBookingDto) {
        return this.bookings.addPassengerDetails(user, dto);
    }

    @Get()
    @ApiOperation({ summary: 'My flight bookings, newest first (FLT-25)' })
    @ApiOkResponse({ description: 'Paginated list of my bookings' })
    findMine(@CurrentUser() user: AuthUser, @Query() query: MyFlightBookingsQueryDto) {
        return this.bookings.findMine(user, query);
    }

    @Get(':id')
    @ApiOperation({ summary: 'One of my flight bookings (FLT-25)' })
    @ApiOkResponse({ description: 'Booking details' })
    @ApiForbiddenResponse({ description: 'Not your booking' })
    @ApiNotFoundResponse({ description: 'Booking not found' })
    findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
        return this.bookings.findOne(user, id);
    }

    @Post(':id/cancel')
    @HttpCode(200)
    @ApiOperation({
        summary: 'Cancel a booking; paid bookings get a refund from the airline’s policy (FLT-26)',
    })
    @ApiOkResponse({ description: 'Cancelled booking with refundPercent and refundAmount' })
    @ApiBadRequestResponse({ description: 'Already cancelled/expired, or the flight has departed' })
    @ApiForbiddenResponse({ description: 'Not your booking' })
    cancel(
        @CurrentUser() user: AuthUser,
        @Param('id') id: string,
        @Body() dto: CancelFlightBookingDto,
    ) {
        return this.bookings.cancel(user, id, dto);
    }

    @Get(':id/e-ticket')
    @ApiOperation({ summary: 'E-ticket of a confirmed booking (FLT-23)' })
    @ApiOkResponse({ description: 'Ticket numbers, passengers and current flight times' })
    @ApiBadRequestResponse({ description: 'Booking is not confirmed' })
    @ApiForbiddenResponse({ description: 'Not your booking' })
    eTicket(@CurrentUser() user: AuthUser, @Param('id') id: string) {
        return this.bookings.eTicket(user, id);
    }
}

// [PR4] moderator controller goes here
