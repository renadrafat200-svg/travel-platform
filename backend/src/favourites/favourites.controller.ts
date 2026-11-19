import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import { AddFavouriteDto, FavouritesQueryDto } from './dto/favourite.dto';
import { FavouritesService } from './favourites.service';
import { FavouriteType } from './schemas/favourite.schema';

@ApiTags('Favourites')
@ApiCookieAuth('access_token')
@ApiUnauthorizedResponse({ description: 'Not logged in' })
@Controller('favourites')
export class FavouritesController {
  constructor(private readonly favourites: FavouritesService) {}

  @Post()
  @ApiOperation({ summary: 'Save a hotel, public itinerary or published post to my favourites (optional bonus)' })
  @ApiCreatedResponse({ description: 'The saved favourite' })
  @ApiNotFoundResponse({ description: 'Not found or not available (inactive, private, hidden, draft)' })
  @ApiConflictResponse({ description: 'Already in my favourites' })
  add(@CurrentUser() user: AuthUser, @Body() dto: AddFavouriteDto) {
    return this.favourites.add(user, dto);
  }

  @Get()
  @ApiOperation({ summary: 'My favourites, newest first; filter with ?type= (optional bonus)' })
  @ApiOkResponse({ description: 'Paginated favourites with title, link and available' })
  list(@CurrentUser() user: AuthUser, @Query() query: FavouritesQueryDto) {
    return this.favourites.list(user, query);
  }

  @Get(':type/:id')
  @ApiParam({ name: 'type', enum: FavouriteType })
  @ApiOperation({ summary: 'Is this in my favourites? (optional bonus)' })
  @ApiOkResponse({ description: '{ type, id, isFavourite }' })
  @ApiBadRequestResponse({ description: 'Unknown type or invalid id' })
  check(@CurrentUser() user: AuthUser, @Param('type') type: FavouriteType, @Param('id') id: string) {
    return this.favourites.check(user, type, id);
  }

  @Delete(':type/:id')
  @HttpCode(204)
  @ApiParam({ name: 'type', enum: FavouriteType })
  @ApiOperation({ summary: 'Remove from my favourites (optional bonus)' })
  @ApiNoContentResponse({ description: 'Removed' })
  @ApiNotFoundResponse({ description: 'Not in my favourites' })
  remove(@CurrentUser() user: AuthUser, @Param('type') type: FavouriteType, @Param('id') id: string) {
    return this.favourites.remove(user, type, id);
  }
}
