import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import {
  CreateHotelDto,
  HotelDetailsQueryDto,
  HotelPoliciesDto,
  HotelQueryDto,
  HotelSearchDto,
  UpdateHotelDto,
} from './dto/hotel.dto';
import { MAX_HOTEL_PHOTOS } from './hotel.constants';
import { HotelSearchService } from './hotel-search.service';
import { HotelsService, MAX_PHOTO_BYTES } from './hotels.service';
import type { UploadedImage } from './hotels.service';

@ApiTags('Hotels')
@ApiCookieAuth('access_token')
@Controller('hotels')
export class HotelsController {
  constructor(
    private readonly hotels: HotelsService,
    private readonly searchService: HotelSearchService,
  ) {}

  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Create a hotel (admin only) (HTL-01)' })
  @ApiCreatedResponse({
    description: 'Hotel created; country is taken from the city',
  })
  @ApiBadRequestResponse({
    description: 'Unknown city, or duplicate cancellation tier thresholds',
  })
  @ApiForbiddenResponse({ description: 'Admins only' })
  create(@CurrentUser() admin: AuthUser, @Body() dto: CreateHotelDto) {
    return this.hotels.create(admin, dto);
  }

  @Get()
  @Public()
  @ApiOperation({
    summary: 'List active hotels, optionally by city or country (public)',
  })
  @ApiOkResponse({ description: 'Paginated hotels, 10 per page' })
  findAll(@Query() query: HotelQueryDto, @CurrentUser() user?: AuthUser) {
    return this.hotels.findAll(query, user);
  }

  // 'search', 'mine' and 'photos/...' must stay above ':id' so they are not read as ids
  @Get('search')
  @Public()
  @ApiOperation({
    summary:
      'Search hotels by city or country, dates, guests and rooms (public) (HTL-11, HTL-12)',
  })
  @ApiOkResponse({
    description:
      'Hotels that can fit the group, with the price per night of the cheapest qualifying room',
  })
  @ApiBadRequestResponse({
    description:
      'No city/country, check-in in the past, check-out not after check-in, minPrice > maxPrice',
  })
  search(@Query() query: HotelSearchDto) {
    return this.searchService.search(query);
  }

  @Get('mine')
  @Roles(Role.HOTEL_MODERATOR)
  @ApiOperation({ summary: 'The hotel I manage (hotel moderator)' })
  @ApiOkResponse({ description: 'Your hotel, including its policies' })
  @ApiForbiddenResponse({ description: 'Hotel moderators only' })
  findMine(@CurrentUser() user: AuthUser) {
    return this.hotels.findMine(user);
  }

  @Get('photos/:fileName')
  @Public()
  @ApiOperation({ summary: 'A hotel photo file (public)' })
  @ApiOkResponse({ description: 'The JPG or PNG image' })
  @ApiNotFoundResponse({ description: 'Photo not found' })
  async photo(
    @Param('fileName') fileName: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.hotels.photoFile(fileName);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return new StreamableFile(file.data);
  }

  @Get(':id')
  @Public()
  @ApiOperation({
    summary:
      'Hotel details: policies, rating, latest reviews, and the free rooms when checkIn and checkOut are given (public) (HTL-02)',
  })
  @ApiOkResponse({
    description: 'Hotel profile; availableRooms only when dates are given',
  })
  @ApiNotFoundResponse({ description: 'Not found or deactivated' })
  findOne(
    @Param('id') id: string,
    @Query() query: HotelDetailsQueryDto,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.searchService.details(id, query, user);
  }

  @Get(':id/policies')
  @Public()
  @ApiOperation({
    summary:
      'Check-in/check-out times and cancellation tiers (public) (HTL-09, HTL-10)',
  })
  @ApiOkResponse({ description: 'The hotel’s policies' })
  @ApiNotFoundResponse({ description: 'Not found or deactivated' })
  async getPolicies(@Param('id') id: string, @CurrentUser() user?: AuthUser) {
    const hotel = this.hotels.toView(await this.hotels.getVisible(id, user));
    return { hotelId: hotel.id, name: hotel.name, ...hotel.policies };
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.HOTEL_MODERATOR)
  @ApiOperation({
    summary:
      'Edit the hotel profile (this hotel’s moderator or an admin) (HTL-02)',
  })
  @ApiOkResponse({ description: 'Updated hotel' })
  @ApiForbiddenResponse({ description: 'Not your hotel' })
  @ApiNotFoundResponse({ description: 'Hotel not found' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateHotelDto,
  ) {
    return this.hotels.update(user, id, dto);
  }

  @Put(':id/policies')
  @Roles(Role.ADMIN, Role.HOTEL_MODERATOR)
  @ApiOperation({
    summary:
      'Set check-in/check-out times and cancellation tiers (HTL-09, HTL-10)',
  })
  @ApiOkResponse({
    description: 'New policies, tiers sorted from the highest threshold',
  })
  @ApiBadRequestResponse({
    description: 'Two tiers with the same daysBeforeCheckIn',
  })
  @ApiForbiddenResponse({ description: 'Not your hotel' })
  updatePolicies(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: HotelPoliciesDto,
  ) {
    return this.hotels.updatePolicies(user, id, dto);
  }

  @Post(':id/photos')
  @Roles(Role.ADMIN, Role.HOTEL_MODERATOR)
  @UseInterceptors(
    FilesInterceptor('photos', MAX_HOTEL_PHOTOS, {
      limits: { fileSize: MAX_PHOTO_BYTES },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['photos'],
      properties: {
        photos: { type: 'array', items: { type: 'string', format: 'binary' } },
      },
    },
  })
  @ApiOperation({
    summary:
      'Upload hotel photos: JPG or PNG, max 5 MB each, max 5 per hotel (GEN-08)',
  })
  @ApiCreatedResponse({ description: 'All photos of the hotel' })
  @ApiBadRequestResponse({
    description: 'Not JPG/PNG, or more than 5 photos in total',
  })
  @ApiForbiddenResponse({ description: 'Not your hotel' })
  addPhotos(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFiles() files: UploadedImage[],
  ) {
    return this.hotels.addPhotos(user, id, files);
  }

  @Delete(':id/photos/:photoId')
  @Roles(Role.ADMIN, Role.HOTEL_MODERATOR)
  @ApiOperation({ summary: 'Remove a hotel photo' })
  @ApiOkResponse({ description: 'Remaining photos' })
  @ApiForbiddenResponse({ description: 'Not your hotel' })
  @ApiNotFoundResponse({ description: 'Photo not found' })
  removePhoto(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('photoId') photoId: string,
  ) {
    return this.hotels.removePhoto(user, id, photoId);
  }
}
