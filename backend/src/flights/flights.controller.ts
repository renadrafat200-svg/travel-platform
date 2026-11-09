import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import { FlightSearchDto } from './dto/flight-search.dto';
import {
  CancelFlightDto,
  CreateCabinDto,
  CreateFlightDto,
  MyFlightsQueryDto,
  UpdateCabinDto,
  UpdateFlightDto,
} from './dto/flight.dto';
import { FlightSearchService } from './flight-search.service';
import { FlightsService } from './flights.service';

@ApiTags('Flights')
@ApiCookieAuth('access_token')
@Controller('flights')
export class FlightsController {
  constructor(
    private readonly flights: FlightsService,
    private readonly searchService: FlightSearchService,
  ) {}

  @Post()
  @Roles(Role.AIRLINE_MODERATOR, Role.ADMIN)
  @ApiOperation({ summary: 'Create a flight, times in each airport’s local time (FLT-03)' })
  @ApiCreatedResponse({ description: 'Flight created' })
  @ApiBadRequestResponse({ description: 'Unknown airport, bad times, or duplicate cabin class' })
  @ApiForbiddenResponse({ description: 'Airline moderators (own airline) and admins only' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateFlightDto) {
    return this.flights.create(user, dto);
  }

  // 'search' and 'mine' must stay above ':id'
  @Get('search')
  @Public()
  @ApiOperation({
    summary:
      'Search one-way or round-trip flights with filters and sorting (FLT-11, FLT-12, FLT-15)',
  })
  @ApiOkResponse({
    description: 'Outbound (and return) flights with the total price for all passengers',
  })
  @ApiBadRequestResponse({ description: 'Invalid search parameters' })
  search(@Query() query: FlightSearchDto) {
    return this.searchService.search(query);
  }

  @Get('mine')
  @Roles(Role.AIRLINE_MODERATOR, Role.ADMIN)
  @ApiOperation({ summary: 'List my airline’s flights (airline moderator; admins pass airlineId)' })
  @ApiOkResponse({ description: 'Paginated flights, including cancelled ones' })
  findMine(@CurrentUser() user: AuthUser, @Query() query: MyFlightsQueryDto) {
    return this.flights.findMine(user, query);
  }

  @Get(':id')
  @Public()
  @ApiOperation({ summary: 'Flight details with local times and cabins (FLT-17)' })
  @ApiOkResponse({ description: 'Flight details' })
  @ApiNotFoundResponse({ description: 'Not found, or its airline is deactivated' })
  findOne(@Param('id') id: string, @CurrentUser() user?: AuthUser) {
    return this.flights.findOne(id, user);
  }

  @Patch(':id')
  @Roles(Role.AIRLINE_MODERATOR, Role.ADMIN)
  @ApiOperation({ summary: 'Change the schedule or flight number (FLT-05)' })
  @ApiOkResponse({ description: 'Updated flight' })
  @ApiBadRequestResponse({ description: 'Cancelled, already departed, or invalid times' })
  @ApiForbiddenResponse({ description: 'Not your airline' })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateFlightDto) {
    return this.flights.update(user, id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Roles(Role.AIRLINE_MODERATOR, Role.ADMIN)
  @ApiOperation({ summary: 'Cancel a flight (FLT-06)' })
  @ApiOkResponse({ description: 'Flight cancelled; it disappears from search' })
  @ApiBadRequestResponse({ description: 'Already cancelled or already departed' })
  @ApiForbiddenResponse({ description: 'Not your airline' })
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CancelFlightDto) {
    return this.flights.cancel(user, id, dto);
  }

  @Post(':id/cabins')
  @Roles(Role.AIRLINE_MODERATOR, Role.ADMIN)
  @ApiOperation({ summary: 'Add a cabin class with seats and prices (FLT-04)' })
  @ApiCreatedResponse({ description: 'Flight with the new cabin' })
  @ApiBadRequestResponse({ description: 'That cabin class already exists on this flight' })
  @ApiForbiddenResponse({ description: 'Not your airline' })
  addCabin(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CreateCabinDto) {
    return this.flights.addCabin(user, id, dto);
  }

  @Patch(':id/cabins/:cabinId')
  @Roles(Role.AIRLINE_MODERATOR, Role.ADMIN)
  @ApiOperation({ summary: 'Change a cabin’s seat count or prices (FLT-04, FLT-05)' })
  @ApiOkResponse({ description: 'Flight with the updated cabin' })
  @ApiBadRequestResponse({ description: 'Fewer seats than are already held or sold' })
  @ApiForbiddenResponse({ description: 'Not your airline' })
  updateCabin(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('cabinId') cabinId: string,
    @Body() dto: UpdateCabinDto,
  ) {
    return this.flights.updateCabin(user, id, cabinId, dto);
  }
}
