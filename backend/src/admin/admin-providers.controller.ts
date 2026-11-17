import { Body, Controller, Param, Patch } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
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
import { AdminProvidersService } from './admin-providers.service';
import { AccountActionDto } from './dto/account-action.dto';

@ApiTags('Admin')
@ApiCookieAuth('access_token')
@ApiForbiddenResponse({ description: 'Admins only' })
@Roles(Role.ADMIN) // every route here is admin-only
@Controller('admin')
export class AdminProvidersController {
  constructor(private readonly providers: AdminProvidersService) {}

  @Patch('airlines/:id/deactivate')
  @ApiOperation({ summary: 'Deactivate an airline: hidden from search and not bookable (ACC-15)' })
  @ApiOkResponse({ description: 'Airline deactivated; existing confirmed bookings stay valid' })
  @ApiBadRequestResponse({ description: 'Airline is already deactivated' })
  @ApiNotFoundResponse({ description: 'Airline not found' })
  deactivateAirline(@CurrentUser() admin: AuthUser, @Param('id') id: string, @Body() dto: AccountActionDto) {
    return this.providers.setAirlineActive(admin, id, false, dto.reason);
  }

  @Patch('airlines/:id/reactivate')
  @ApiOperation({ summary: 'Reactivate a deactivated airline (ACC-15)' })
  @ApiOkResponse({ description: 'Airline active again' })
  @ApiBadRequestResponse({ description: 'Airline is already active' })
  @ApiNotFoundResponse({ description: 'Airline not found' })
  reactivateAirline(@CurrentUser() admin: AuthUser, @Param('id') id: string, @Body() dto: AccountActionDto) {
    return this.providers.setAirlineActive(admin, id, true, dto.reason);
  }

  @Patch('hotels/:id/deactivate')
  @ApiOperation({ summary: 'Deactivate a hotel: hidden from search and not bookable (ACC-15)' })
  @ApiOkResponse({ description: 'Hotel deactivated; existing confirmed bookings stay valid' })
  @ApiBadRequestResponse({ description: 'Hotel is already deactivated' })
  @ApiNotFoundResponse({ description: 'Hotel not found' })
  deactivateHotel(@CurrentUser() admin: AuthUser, @Param('id') id: string, @Body() dto: AccountActionDto) {
    return this.providers.setHotelActive(admin, id, false, dto.reason);
  }

  @Patch('hotels/:id/reactivate')
  @ApiOperation({ summary: 'Reactivate a deactivated hotel (ACC-15)' })
  @ApiOkResponse({ description: 'Hotel active again' })
  @ApiBadRequestResponse({ description: 'Hotel is already active' })
  @ApiNotFoundResponse({ description: 'Hotel not found' })
  reactivateHotel(@CurrentUser() admin: AuthUser, @Param('id') id: string, @Body() dto: AccountActionDto) {
    return this.providers.setHotelActive(admin, id, true, dto.reason);
  }
}
