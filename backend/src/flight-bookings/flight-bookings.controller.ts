import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
    ApiBadRequestResponse,
    ApiConflictResponse,
    ApiCookieAuth,
    ApiCreatedResponse,
    ApiForbiddenResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import {
    CancelFlightBookingDto,
    CreateFlightBookingDto,
    MyFlightBookingsQueryDto,
} from './dto/flight-booking.dto';
import { FlightBookingsService } from './flight-bookings.service';

@ApiTags('Flight bookings')
@ApiCookieAuth('access_token')
@Controller('flight-bookings')
export class FlightBookingsController {
    constructor(private readonly bookings: FlightBookingsService) { }

    @Post()
    @Roles(Role.USER)
    @ApiOperation({
        summary: 'Book a one-way or round-trip flight; seats are held while you pay (FLT-22)',
    })
    @ApiCreatedResponse({
        description: 'Pending booking with the total price and holdExpiresAt',
    })
    @ApiBadRequestResponse({
        description: 'Cancelled flight, booking closed, wrong passengers',
    })
    @ApiConflictResponse({
        description: 'Not enough seats, or too many unpaid bookings',
    })
    @ApiNotFoundResponse({ description: 'Flight not found' })
    create(@CurrentUser() user: AuthUser, @Body() dto: CreateFlightBookingDto) {
        return this.bookings.create(user, dto);
    }

    // 'mine' must stay above ':id'
    @Get('mine')
    @ApiOperation({ summary: 'My flight bookings, newest first' })
    @ApiOkResponse({ description: 'Paginated list of my bookings' })
    findMine(@CurrentUser() user: AuthUser, @Query() query: MyFlightBookingsQueryDto) {
        return this.bookings.findMine(user, query);
    }

    @Get(':id')
    @ApiOperation({ summary: 'One of my flight bookings' })
    @ApiOkResponse({ description: 'Booking details' })
    @ApiForbiddenResponse({ description: 'Not your booking' })
    @ApiNotFoundResponse({ description: 'Booking not found' })
    findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
        return this.bookings.findOne(user, id);
    }

    @Get(':id/e-ticket')
    @ApiOperation({ summary: 'E-ticket of a confirmed booking' })
    @ApiOkResponse({
        description: 'Ticket numbers, passengers and current flight times',
    })
    @ApiBadRequestResponse({ description: 'Booking is not confirmed' })
    @ApiForbiddenResponse({ description: 'Not your booking' })
    eTicket(@CurrentUser() user: AuthUser, @Param('id') id: string) {
        return this.bookings.eTicket(user, id);
    }

    @Patch(':id/cancel')
    @ApiOperation({
        summary: 'Cancel a booking; paid bookings get a refund from the airline’s policy',
    })
    @ApiOkResponse({
        description: 'Cancelled booking with refundPercent and refundAmount',
    })
    @ApiBadRequestResponse({
        description: 'Already cancelled/expired, or the flight has departed',
    })
    @ApiForbiddenResponse({ description: 'Not your booking' })
    cancel(
        @CurrentUser() user: AuthUser,
        @Param('id') id: string,
        @Body() dto: CancelFlightBookingDto,
    ) {
        return this.bookings.cancel(user, id, dto);
    }
}

/** Moderator view, under /api/flights so it sits next to the flight it belongs to */
@ApiTags('Flight bookings')
@ApiCookieAuth('access_token')
@Controller('flights')
export class FlightPassengersController {
    constructor(private readonly bookings: FlightBookingsService) { }

    @Get(':flightId/passengers')
    @Roles(Role.AIRLINE_MODERATOR, Role.ADMIN)
    @ApiOperation({ summary: 'Passenger list of one of my airline’s flights' })
    @ApiOkResponse({
        description: 'Everyone with a confirmed ticket on this flight',
    })
    @ApiForbiddenResponse({ description: 'Not your airline' })
    @ApiNotFoundResponse({ description: 'Flight not found' })
    passengers(@CurrentUser() user: AuthUser, @Param('flightId') flightId: string) {
        return this.bookings.passengerList(user, flightId);
    }
}