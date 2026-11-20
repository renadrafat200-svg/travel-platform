import { BadRequestException, Body, Controller, Param, Patch } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
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

  // The project PDF's paths (section 8): one route for both kinds of provider

  @Patch('providers/:type/:id/deactivate')
  @ApiParam({ name: 'type', enum: ['airline', 'hotel'] })
  @ApiOperation({ summary: 'Deactivate an airline or a hotel: hidden from search and not bookable (ACC-15)' })
  @ApiOkResponse({ description: 'Provider deactivated; existing confirmed bookings stay valid' })
  @ApiBadRequestResponse({ description: 'Unknown type, or already deactivated' })
  @ApiNotFoundResponse({ description: 'Provider not found' })
  deactivateProvider(
    @CurrentUser() admin: AuthUser,
    @Param('type') type: string,
    @Param('id') id: string,
    @Body() dto: AccountActionDto,
  ) {
    return this.setProvider(admin, type, id, false, dto.reason);
  }

  @Patch('providers/:type/:id/reactivate')
  @ApiParam({ name: 'type', enum: ['airline', 'hotel'] })
  @ApiOperation({ summary: 'Reactivate a deactivated airline or hotel (ACC-15)' })
  @ApiOkResponse({ description: 'Provider active again' })
  @ApiBadRequestResponse({ description: 'Unknown type, or already active' })
  @ApiNotFoundResponse({ description: 'Provider not found' })
  reactivateProvider(
    @CurrentUser() admin: AuthUser,
    @Param('type') type: string,
    @Param('id') id: string,
    @Body() dto: AccountActionDto,
  ) {
    return this.setProvider(admin, type, id, true, dto.reason);
  }

  private setProvider(admin: AuthUser, type: string, id: string, active: boolean, reason?: string) {
    const kind = type.toLowerCase().replace(/s$/, '');
    if (kind === 'airline') return this.providers.setAirlineActive(admin, id, active, reason);
    if (kind === 'hotel') return this.providers.setHotelActive(admin, id, active, reason);
    throw new BadRequestException('type must be "airline" or "hotel"');
  }
}
