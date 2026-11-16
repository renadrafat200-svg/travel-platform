import {
  Body,
  Controller,
  Delete,
  Get,
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
import { AvailableRoomsQueryDto } from './dto/hotel.dto';
import {
  CreateRoomBlockDto,
  CreateRoomDto,
  DateRangeDto,
  RoomCalendarQueryDto,
  RoomListQueryDto,
  UpdateRoomDto,
} from './dto/room.dto';
import { HotelSearchService } from './hotel-search.service';
import { RoomsService } from './rooms.service';

/** Rooms, bookable ranges, blocked dates and the room calendar, nested under their hotel */
@ApiTags('Hotel rooms')
@ApiCookieAuth('access_token')
@Controller('hotels/:hotelId/rooms')
export class RoomsController {
  constructor(
    private readonly rooms: RoomsService,
    private readonly searchService: HotelSearchService,
  ) {}

  @Post()
  @Roles(Role.ADMIN, Role.HOTEL_MODERATOR)
  @ApiOperation({
    summary: 'Add a room (this hotel’s moderator or an admin) (HTL-03)',
  })
  @ApiCreatedResponse({
    description: 'Room created. Add a bookable date range so it can be booked.',
  })
  @ApiConflictResponse({
    description: 'This room number/name already exists in the hotel',
  })
  @ApiForbiddenResponse({ description: 'Not your hotel' })
  create(
    @CurrentUser() user: AuthUser,
    @Param('hotelId') hotelId: string,
    @Body() dto: CreateRoomDto,
  ) {
    return this.rooms.create(user, hotelId, dto);
  }

  @Get()
  @Public()
  @ApiOperation({
    summary:
      'Rooms of a hotel (public; moderators can include deactivated rooms)',
  })
  @ApiOkResponse({
    description: 'Rooms with type, beds, max occupancy and price per night',
  })
  @ApiNotFoundResponse({ description: 'Hotel not found or deactivated' })
  findAll(
    @Param('hotelId') hotelId: string,
    @Query() query: RoomListQueryDto,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.rooms.findAll(hotelId, query, user);
  }

  // Must stay above ':roomId' so "available" is not read as a room id
  @Get('available')
  @Public()
  @ApiOperation({
    summary:
      'Rooms free for the given dates, with the total stay price (public) (HTL-15)',
  })
  @ApiOkResponse({
    description:
      'Type, beds, max occupancy, price per night and total price of each free room',
  })
  @ApiBadRequestResponse({
    description: 'Check-in in the past, or check-out not after check-in',
  })
  @ApiNotFoundResponse({ description: 'Hotel not found or deactivated' })
  available(
    @Param('hotelId') hotelId: string,
    @Query() query: AvailableRoomsQueryDto,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.searchService.availableRooms(hotelId, query, user);
  }

  @Get(':roomId')
  @Public()
  @ApiOperation({ summary: 'One room with its bookable date ranges (public)' })
  @ApiOkResponse({ description: 'Room details' })
  @ApiNotFoundResponse({ description: 'Room not found' })
  findOne(
    @Param('hotelId') hotelId: string,
    @Param('roomId') roomId: string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.rooms.findOne(hotelId, roomId, user);
  }

  @Patch(':roomId')
  @Roles(Role.ADMIN, Role.HOTEL_MODERATOR)
  @ApiOperation({ summary: 'Edit beds, occupancy, price or details (HTL-05)' })
  @ApiOkResponse({
    description:
      'Updated room. Price changes do not affect existing reservations.',
  })
  @ApiForbiddenResponse({ description: 'Not your hotel' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('hotelId') hotelId: string,
    @Param('roomId') roomId: string,
    @Body() dto: UpdateRoomDto,
  ) {
    return this.rooms.update(user, hotelId, roomId, dto);
  }

  @Patch(':roomId/deactivate')
  @Roles(Role.ADMIN, Role.HOTEL_MODERATOR)
  @ApiOperation({
    summary: 'Deactivate a room; it disappears from search (HTL-06)',
  })
  @ApiOkResponse({ description: 'Room with isActive = false' })
  @ApiConflictResponse({
    description: 'The room has a confirmed or pending reservation',
  })
  @ApiForbiddenResponse({ description: 'Not your hotel' })
  deactivate(
    @CurrentUser() user: AuthUser,
    @Param('hotelId') hotelId: string,
    @Param('roomId') roomId: string,
  ) {
    return this.rooms.deactivate(user, hotelId, roomId);
  }

  @Patch(':roomId/reactivate')
  @Roles(Role.ADMIN, Role.HOTEL_MODERATOR)
  @ApiOperation({ summary: 'Reactivate a room' })
  @ApiOkResponse({ description: 'Room with isActive = true' })
  @ApiForbiddenResponse({ description: 'Not your hotel' })
  reactivate(
    @CurrentUser() user: AuthUser,
    @Param('hotelId') hotelId: string,
    @Param('roomId') roomId: string,
  ) {
    return this.rooms.reactivate(user, hotelId, roomId);
  }

  @Delete(':roomId')
  @Roles(Role.ADMIN, Role.HOTEL_MODERATOR)
  @ApiOperation({ summary: 'Delete a room that was never reserved (HTL-06)' })
  @ApiOkResponse({ description: '{ deleted: true }' })
  @ApiConflictResponse({
    description: 'The room has been reserved before; deactivate it instead',
  })
  @ApiForbiddenResponse({ description: 'Not your hotel' })
  remove(
    @CurrentUser() user: AuthUser,
    @Param('hotelId') hotelId: string,
    @Param('roomId') roomId: string,
  ) {
    return this.rooms.remove(user, hotelId, roomId);
  }

  // ---------- bookable date ranges (HTL-04, HTL-05) ----------

  @Post(':roomId/availability')
  @Roles(Role.ADMIN, Role.HOTEL_MODERATOR)
  @ApiOperation({
    summary:
      'Add a date range when the room can be booked (from = first night, to = first night not included) (HTL-04)',
  })
  @ApiCreatedResponse({ description: 'Bookable range added' })
  @ApiBadRequestResponse({ description: 'Past or invalid dates' })
  @ApiConflictResponse({
    description: 'Overlaps another bookable range of this room',
  })
  @ApiForbiddenResponse({ description: 'Not your hotel' })
  addRange(
    @CurrentUser() user: AuthUser,
    @Param('hotelId') hotelId: string,
    @Param('roomId') roomId: string,
    @Body() dto: DateRangeDto,
  ) {
    return this.rooms.addRange(user, hotelId, roomId, dto);
  }

  @Get(':roomId/availability')
  @Public()
  @ApiOperation({ summary: 'Bookable date ranges of a room (public)' })
  @ApiOkResponse({ description: 'Ranges, earliest first' })
  listRanges(
    @Param('hotelId') hotelId: string,
    @Param('roomId') roomId: string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.rooms.listRanges(hotelId, roomId, user);
  }

  @Patch(':roomId/availability/:rangeId')
  @Roles(Role.ADMIN, Role.HOTEL_MODERATOR)
  @ApiOperation({ summary: 'Change a bookable range (HTL-05)' })
  @ApiOkResponse({ description: 'Updated range' })
  @ApiConflictResponse({
    description:
      'Overlaps another range, or would remove nights with a confirmed reservation',
  })
  @ApiForbiddenResponse({ description: 'Not your hotel' })
  updateRange(
    @CurrentUser() user: AuthUser,
    @Param('hotelId') hotelId: string,
    @Param('roomId') roomId: string,
    @Param('rangeId') rangeId: string,
    @Body() dto: DateRangeDto,
  ) {
    return this.rooms.updateRange(user, hotelId, roomId, rangeId, dto);
  }

  @Delete(':roomId/availability/:rangeId')
  @Roles(Role.ADMIN, Role.HOTEL_MODERATOR)
  @ApiOperation({ summary: 'Remove a bookable range (HTL-05)' })
  @ApiOkResponse({ description: '{ removed: true }' })
  @ApiConflictResponse({
    description: 'The range has nights with a confirmed reservation',
  })
  @ApiForbiddenResponse({ description: 'Not your hotel' })
  removeRange(
    @CurrentUser() user: AuthUser,
    @Param('hotelId') hotelId: string,
    @Param('roomId') roomId: string,
    @Param('rangeId') rangeId: string,
  ) {
    return this.rooms.removeRange(user, hotelId, roomId, rangeId);
  }

  // ---------- blocked dates (HTL-06) ----------

  @Post(':roomId/blocks')
  @Roles(Role.ADMIN, Role.HOTEL_MODERATOR)
  @ApiOperation({
    summary:
      'Block a date range (from = first night, to = first free night) (HTL-06)',
  })
  @ApiCreatedResponse({
    description: 'Block created; those nights cannot be booked',
  })
  @ApiBadRequestResponse({ description: 'Past or invalid dates' })
  @ApiConflictResponse({
    description:
      'Overlaps a confirmed or pending reservation, or another block',
  })
  @ApiForbiddenResponse({ description: 'Not your hotel' })
  createBlock(
    @CurrentUser() user: AuthUser,
    @Param('hotelId') hotelId: string,
    @Param('roomId') roomId: string,
    @Body() dto: CreateRoomBlockDto,
  ) {
    return this.rooms.createBlock(user, hotelId, roomId, dto);
  }

  @Get(':roomId/blocks')
  @Roles(Role.ADMIN, Role.HOTEL_MODERATOR)
  @ApiOperation({ summary: 'Current and upcoming blocks of a room' })
  @ApiOkResponse({ description: 'Blocks, earliest first' })
  @ApiForbiddenResponse({ description: 'Not your hotel' })
  listBlocks(
    @CurrentUser() user: AuthUser,
    @Param('hotelId') hotelId: string,
    @Param('roomId') roomId: string,
  ) {
    return this.rooms.listBlocks(user, hotelId, roomId);
  }

  @Delete(':roomId/blocks/:blockId')
  @Roles(Role.ADMIN, Role.HOTEL_MODERATOR)
  @ApiOperation({ summary: 'Remove a block so the nights can be booked again' })
  @ApiOkResponse({ description: '{ removed: true }' })
  @ApiForbiddenResponse({ description: 'Not your hotel' })
  @ApiNotFoundResponse({ description: 'Block not found' })
  removeBlock(
    @CurrentUser() user: AuthUser,
    @Param('hotelId') hotelId: string,
    @Param('roomId') roomId: string,
    @Param('blockId') blockId: string,
  ) {
    return this.rooms.removeBlock(user, hotelId, roomId, blockId);
  }

  // ---------- calendar (HTL-08) ----------

  @Get(':roomId/calendar')
  @Roles(Role.ADMIN, Role.HOTEL_MODERATOR)
  @ApiOperation({
    summary:
      'Room status per night: available, booked (with reservation reference) or blocked (HTL-08)',
  })
  @ApiOkResponse({
    description:
      'One entry per night; nights outside every bookable range are not_bookable',
  })
  @ApiForbiddenResponse({ description: 'Not your hotel' })
  calendar(
    @CurrentUser() user: AuthUser,
    @Param('hotelId') hotelId: string,
    @Param('roomId') roomId: string,
    @Query() query: RoomCalendarQueryDto,
  ) {
    return this.rooms.calendar(user, hotelId, roomId, query);
  }
}
