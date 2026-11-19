import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import {
  AddDayDto,
  CreateItineraryDto,
  ReorderDayDto,
  UpdateDayDto,
  UpdateItineraryDto,
} from './dto/itinerary.dto';
import {
  BudgetSummaryQueryDto,
  CreateActivityDto,
  CreateBudgetDto,
  CreateTransportCostDto,
} from './dto/itinerary-items.dto';
import { ItinerariesService } from './itineraries.service';
import { ItineraryItemsService } from './itinerary-items.service';

/**
 * Itineraries (Member 7). Paths are exactly the ones in the project PDF.
 * Every route here needs login; private itineraries answer 404 to anyone but the owner and admins.
 */
@ApiTags('Itineraries')
@ApiCookieAuth('access_token')
@ApiUnauthorizedResponse({ description: 'Not logged in' })
@Controller('itineraries')
export class ItinerariesController {
  constructor(
    private readonly itineraries: ItinerariesService,
    private readonly items: ItineraryItemsService,
  ) {}

  // ---------------- Itinerary ----------------

  @Post()
  @ApiOperation({
    summary:
      'Create an itinerary: title (max 100), one or more countries and a start date. Private by default (ITN-01)',
  })
  @ApiCreatedResponse({ description: 'The new itinerary' })
  @ApiBadRequestResponse({
    description: 'Missing title, unknown country or invalid start date',
  })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateItineraryDto) {
    return this.itineraries.create(user, dto);
  }

  @Get()
  @ApiOperation({
    summary:
      'My itineraries: title, countries, start date, days and visibility, most recently updated first (ITN-03)',
  })
  @ApiOkResponse({ description: 'Paginated list of my itineraries' })
  listMine(@CurrentUser() user: AuthUser, @Query() query: PaginationQueryDto) {
    return this.itineraries.listMine(user, query);
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'One of my itineraries with its days, dates and city groups (ITN-03, ITN-09)',
  })
  @ApiOkResponse({ description: 'The full itinerary' })
  @ApiNotFoundResponse({ description: 'Not found or not yours' })
  findMine(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.itineraries.findMine(user, id);
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Edit title, countries or start date, or set visibility public/private (ITN-01, ITN-20)',
    description:
      'Changing startDate moves the date of every day. Setting visibility to private removes it from public search immediately.',
  })
  @ApiOkResponse({ description: 'The updated itinerary' })
  @ApiBadRequestResponse({ description: 'Nothing to change or invalid fields' })
  @ApiForbiddenResponse({ description: "Someone else's public itinerary (read-only)" })
  @ApiNotFoundResponse({ description: 'Not found or not yours' })
  @ApiConflictResponse({ description: 'Changed by another request at the same time' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateItineraryDto,
  ) {
    return this.itineraries.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary:
      'Delete my itinerary after the user confirmed. It leaves public search; clones made by others stay (ITN-01)',
  })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiForbiddenResponse({ description: "Someone else's public itinerary (read-only)" })
  @ApiNotFoundResponse({ description: 'Not found or not yours' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.itineraries.remove(user, id);
  }

  // ---------------- Days ----------------

  @Post(':id/days')
  @ApiOperation({
    summary:
      'Add a day with its city and notes, at the end or at a position. Max 60 days (ITN-05)',
  })
  @ApiCreatedResponse({ description: 'The itinerary with renumbered days' })
  @ApiBadRequestResponse({ description: 'Unknown city or already 60 days' })
  @ApiNotFoundResponse({ description: 'Not found or not yours' })
  addDay(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: AddDayDto,
  ) {
    return this.itineraries.addDay(user, id, dto);
  }

  // 'reorder' must stay above ':dayId' so it is not read as a day id
  @Patch(':id/days/reorder')
  @ApiOperation({
    summary:
      'Move a day to a new position; days are renumbered and dates and city groups recalculated (ITN-08)',
  })
  @ApiOkResponse({ description: 'The itinerary in its new order' })
  @ApiBadRequestResponse({ description: 'Position out of range' })
  @ApiNotFoundResponse({ description: 'Itinerary or day not found' })
  reorderDay(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ReorderDayDto,
  ) {
    return this.itineraries.reorderDay(user, id, dto);
  }

  @Patch(':id/days/:dayId')
  @ApiOperation({ summary: "Edit a day's city or notes (ITN-05)" })
  @ApiOkResponse({ description: 'The updated itinerary' })
  @ApiBadRequestResponse({ description: 'Unknown city or nothing to change' })
  @ApiNotFoundResponse({ description: 'Itinerary or day not found' })
  updateDay(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('dayId') dayId: string,
    @Body() dto: UpdateDayDto,
  ) {
    return this.itineraries.updateDay(user, id, dayId, dto);
  }

  @Delete(':id/days/:dayId')
  @ApiOperation({
    summary:
      'Delete a day; the remaining days are renumbered and dates and totals recalculated (ITN-07)',
  })
  @ApiOkResponse({ description: 'The itinerary without that day' })
  @ApiNotFoundResponse({ description: 'Itinerary or day not found' })
  removeDay(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('dayId') dayId: string,
  ) {
    return this.itineraries.removeDay(user, id, dayId);
  }

  // ---------------- Activities, budgets, transport (edit/delete: /api/activities, /api/budgets, /api/transport-costs) ----------------

  @Post(':id/days/:dayId/activities')
  @ApiOperation({
    summary:
      'Add an activity to a day: name, description, optional time and optional cost (ITN-10)',
    description:
      'A cost without a currency uses your preferred currency. Costs count under the "activities" budget category.',
  })
  @ApiCreatedResponse({ description: 'The updated itinerary' })
  @ApiBadRequestResponse({ description: 'Missing name, bad time, negative cost or unsupported currency' })
  @ApiNotFoundResponse({ description: 'Itinerary or day not found' })
  addActivity(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('dayId') dayId: string,
    @Body() dto: CreateActivityDto,
  ) {
    return this.items.addActivity(user, id, dayId, dto);
  }

  @Post(':id/days/:dayId/budgets')
  @ApiOperation({
    summary:
      'Add a budget entry to a day: food, accommodation, in-city transport or activities, in any supported currency (ITN-14)',
  })
  @ApiCreatedResponse({ description: 'The updated itinerary' })
  @ApiBadRequestResponse({ description: 'Negative amount, unknown category or unsupported currency' })
  @ApiNotFoundResponse({ description: 'Itinerary or day not found' })
  addBudget(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('dayId') dayId: string,
    @Body() dto: CreateBudgetDto,
  ) {
    return this.items.addBudget(user, id, dayId, dto);
  }

  @Post(':id/transport-costs')
  @ApiOperation({
    summary:
      'Add an intercity transport cost: mode, from-city, to-city, amount, currency and the day it counts on (ITN-16)',
  })
  @ApiCreatedResponse({ description: 'The updated itinerary' })
  @ApiBadRequestResponse({ description: 'Unknown city, negative amount or unsupported currency' })
  @ApiNotFoundResponse({ description: 'Itinerary or day not found' })
  addTransport(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateTransportCostDto,
  ) {
    return this.items.addTransport(user, id, dto);
  }

  @Get(':id/budget-summary')
  @ApiOperation({
    summary:
      'Budget totals by category, by day, by city group and overall, converted to one currency (ITN-14, ITN-16, ITN-18)',
    description:
      'Every amount (budget entries, activity costs, transport) is converted with the cached daily exchange rates; rateDate shows their date. If FXRatesAPI is down, the last cached rates are used. Booking prices are not converted (PAY-04).',
  })
  @ApiOkResponse({
    description:
      '{ currency, rateDate, byCategory, byDay, byGroup, total, originalAmounts }',
  })
  @ApiBadRequestResponse({ description: 'Invalid or unsupported currency code' })
  @ApiNotFoundResponse({ description: 'Not found or not yours' })
  @ApiServiceUnavailableResponse({
    description: 'No exchange rates available (none cached and the API is down)',
  })
  budgetSummary(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() query: BudgetSummaryQueryDto,
  ) {
    return this.items.budgetSummary(user, id, query.currency);
  }
}
