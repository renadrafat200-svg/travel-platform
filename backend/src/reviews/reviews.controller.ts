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
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import {
  CreateReviewDto,
  HotelReviewsQueryDto,
  UpdateReviewDto,
} from './dto/review.dto';
import { ReviewsService } from './reviews.service';

/**
 * Hotel reviews (HTL-23, HTL-24). Paths are the ones in the project PDF (section 8.6),
 * so this controller has no common prefix.
 */
@ApiTags('Hotel reviews')
@Controller()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post('hotel-bookings/:id/review')
  @Roles(Role.USER)
  @ApiCookieAuth('access_token')
  @ApiParam({ name: 'id', description: 'The hotel reservation id' })
  @ApiOperation({
    summary: 'Rate and review a hotel after a Completed stay (HTL-23)',
    description:
      'One rating (1-5) and an optional comment (max 1000 characters) per Completed reservation, ' +
      'whatever the number of rooms. The hotel average rating is recalculated.',
  })
  @ApiCreatedResponse({ description: 'The new review' })
  @ApiBadRequestResponse({
    description:
      'Rating not 1-5, comment too long, or the stay is not Completed yet',
  })
  @ApiUnauthorizedResponse({ description: 'Not logged in' })
  @ApiForbiddenResponse({ description: 'Not your reservation' })
  @ApiNotFoundResponse({ description: 'Reservation not found' })
  @ApiConflictResponse({ description: 'This reservation already has a review' })
  create(
    @CurrentUser() user: AuthUser,
    @Param('id') bookingId: string,
    @Body() dto: CreateReviewDto,
  ) {
    return this.reviews.create(user, bookingId, dto);
  }

  @Public()
  @Get('hotels/:id/reviews')
  @ApiParam({ name: 'id', description: 'The hotel id' })
  @ApiOperation({
    summary:
      "A hotel's average rating, number of ratings and reviews, newest first (public) (HTL-24)",
  })
  @ApiOkResponse({
    description:
      '{ hotelId, hotelName, averageRating (null when unrated), ratingCount, reviews: { items, total, page, limit, totalPages } }',
  })
  @ApiNotFoundResponse({ description: 'Hotel not found' })
  listForHotel(
    @Param('id') hotelId: string,
    @Query() query: HotelReviewsQueryDto,
  ) {
    return this.reviews.listForHotel(hotelId, query);
  }

  @Get('reviews/mine')
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary:
      'The reviews I wrote, newest first (hidden ones are marked isHidden)',
  })
  @ApiOkResponse({ description: 'Paginated list of my reviews' })
  @ApiUnauthorizedResponse({ description: 'Not logged in' })
  listMine(
    @CurrentUser() user: AuthUser,
    @Query() query: HotelReviewsQueryDto,
  ) {
    return this.reviews.listMine(user, query);
  }

  @Public()
  @Get('reviews/:id')
  @ApiOperation({
    summary:
      'One review (public). A hidden review is visible only to its author and admins (GEN-10)',
  })
  @ApiOkResponse({ description: 'The review' })
  @ApiNotFoundResponse({ description: 'Review not found (or hidden)' })
  getOne(@Param('id') id: string, @CurrentUser() user?: AuthUser) {
    return this.reviews.getOne(user, id);
  }

  @Patch('reviews/:id')
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Edit my review: rating and/or comment (HTL-23)',
    description:
      'Only the author can edit. The hotel average rating is recalculated.',
  })
  @ApiOkResponse({ description: 'The updated review' })
  @ApiBadRequestResponse({
    description: 'Nothing to change, rating not 1-5, or comment too long',
  })
  @ApiUnauthorizedResponse({ description: 'Not logged in' })
  @ApiNotFoundResponse({ description: 'Review not found (or not yours)' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateReviewDto,
  ) {
    return this.reviews.update(user, id, dto);
  }

  @Delete('reviews/:id')
  @HttpCode(204)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Delete my review (an admin can delete any review) (HTL-23)',
    description: 'The hotel average rating is recalculated.',
  })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiUnauthorizedResponse({ description: 'Not logged in' })
  @ApiNotFoundResponse({ description: 'Review not found (or not yours)' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.reviews.remove(user, id);
  }
}
