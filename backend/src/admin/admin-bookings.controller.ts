import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { AdminBookingsService } from './admin-bookings.service';
import { AdminBookingsQueryDto } from './dto/admin-bookings-query.dto';

@ApiTags('Admin')
@ApiCookieAuth('access_token')
@ApiForbiddenResponse({ description: 'Admins only' })
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminBookingsController {
  constructor(private readonly bookings: AdminBookingsService) {}

  @Get('bookings')
  @ApiOperation({ summary: 'View all flight or hotel bookings across the platform (ACC-17)' })
  @ApiOkResponse({ description: 'Paginated bookings, newest first, 10 per page by default' })
  @ApiBadRequestResponse({ description: 'Invalid filter, e.g. status=completed for flights' })
  list(@Query() query: AdminBookingsQueryDto) {
    return this.bookings.list(query);
  }
}
