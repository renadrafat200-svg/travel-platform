import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
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
  CancelHotelBookingDto,
  CreateHotelBookingDto,
  HotelReservationsQueryDto,
  MyHotelBookingsQueryDto,
} from './dto/hotel-booking.dto';
import { HotelBookingsService } from './hotel-bookings.service';

@ApiTags('Hotel bookings')
@ApiCookieAuth('access_token')
@Controller('hotel-bookings')
export class HotelBookingsController {
  constructor(private readonly bookings: HotelBookingsService) {}

  @Post()
  @Roles(Role.USER)
  @ApiOperation({
    summary:
      'Reserve one or more rooms of a hotel for the same dates; all rooms are held for 10 minutes as one Pending Payment reservation (HTL-16, HTL-18)',
  })
  @ApiCreatedResponse({
    description: 'Pending reservation with holdExpiresAt and the total in USD',
  })
  @ApiBadRequestResponse({
    description:
      'Past dates, check-out not after check-in, no adult, or a room over its max occupancy',
  })
  @ApiConflictResponse({
    description:
      'A room is reserved, on hold, blocked or not bookable on these dates; nothing was held',
  })
  @ApiNotFoundResponse({
    description: 'Hotel or room not found, or deactivated',
  })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateHotelBookingDto) {
    return this.bookings.create(user, dto);
  }

  @Get()
  @ApiOperation({
    summary:
      'My hotel reservations grouped as upcoming, past and cancelled (HTL-20)',
  })
  @ApiOkResponse({
    description:
      '{ upcoming, past, cancelled }, or one paginated group with ?group=',
  })
  findMine(
    @CurrentUser() user: AuthUser,
    @Query() query: MyHotelBookingsQueryDto,
  ) {
    return this.bookings.findMine(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Full details of one of my reservations (HTL-20)' })
  @ApiOkResponse({ description: 'Reservation details' })
  @ApiForbiddenResponse({ description: 'Not your reservation' })
  @ApiNotFoundResponse({ description: 'Reservation not found' })
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bookings.findOne(user, id);
  }

  @Get(':id/refund-preview')
  @ApiOperation({
    summary: 'The refund you would get if you cancelled now (HTL-21)',
  })
  @ApiOkResponse({
    description:
      'Days before check-in, refund percent and amount on the full total',
  })
  @ApiBadRequestResponse({
    description: 'Not confirmed, or the check-in date has been reached',
  })
  @ApiForbiddenResponse({ description: 'Not your reservation' })
  refundPreview(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bookings.refundPreview(user, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Cancel a confirmed reservation as a whole, before the check-in date (HTL-21)',
  })
  @ApiOkResponse({
    description:
      'Cancelled reservation with refundPercent, refundAmount and refundStatus',
  })
  @ApiBadRequestResponse({
    description: 'Not confirmed, or the check-in date has been reached',
  })
  @ApiForbiddenResponse({ description: 'Not your reservation' })
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CancelHotelBookingDto,
  ) {
    return this.bookings.cancel(user, id, dto);
  }
}

/** Hotel moderator reservations view (HTL-22), under /api/hotels next to the hotel */
@ApiTags('Hotel bookings')
@ApiCookieAuth('access_token')
@Controller('hotels')
export class HotelReservationsController {
  constructor(private readonly bookings: HotelBookingsService) {}

  // ':id/reservations' is the project PDF's path; ':id/bookings' kept for existing clients
  @Get([':id/reservations', ':id/bookings'])
  @Roles(Role.HOTEL_MODERATOR, Role.ADMIN)
  @ApiOperation({
    summary: 'Reservations of my hotel: guest, dates and status (HTL-22)',
  })
  @ApiOkResponse({
    description: 'Paginated reservations; filter by status, dates or room',
  })
  @ApiForbiddenResponse({ description: 'Not your hotel' })
  @ApiNotFoundResponse({ description: 'Hotel not found' })
  reservations(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() query: HotelReservationsQueryDto,
  ) {
    return this.bookings.reservations(user, id, query);
  }

  @Post(':id/bookings/:bookingId/cancel')
  @HttpCode(200)
  @Roles(Role.HOTEL_MODERATOR, Role.ADMIN)
  @ApiOperation({
    summary:
      'The hotel cancels a guest’s confirmed reservation (100% refund, PAY-03)',
  })
  @ApiOkResponse({ description: 'Cancelled reservation' })
  @ApiBadRequestResponse({ description: 'Not confirmed, or the stay is over' })
  @ApiForbiddenResponse({ description: 'Not your hotel' })
  @ApiNotFoundResponse({ description: 'Reservation not found in this hotel' })
  cancelByHotel(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('bookingId') bookingId: string,
    @Body() dto: CancelHotelBookingDto,
  ) {
    return this.bookings.cancelByHotel(user, id, bookingId, dto);
  }
}
