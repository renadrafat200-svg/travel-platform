import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
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
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import {
  MAX_IMAGE_BYTES,
  type UploadedImage,
} from '../common/utils/image-upload';
import {
  UpdateActivityDto,
  UpdateBudgetDto,
  UpdateTransportCostDto,
} from './dto/itinerary-items.dto';
import { MAX_ACTIVITY_IMAGES } from './itinerary.constants';
import { ItineraryItemsService } from './itinerary-items.service';

/**
 * Edit/delete routes for the parts of an itinerary (paths from the project PDF):
 * /api/activities/:id, /api/budgets/:id, /api/transport-costs/:id.
 * Each one finds its itinerary and only lets the owner (or an admin) change it.
 */
@ApiTags('Itineraries')
@Controller()
export class ItineraryItemsController {
  constructor(private readonly items: ItineraryItemsService) {}

  // ---------------- Activities (ITN-10) ----------------

  @Patch('activities/:id')
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Edit an activity: name, description, time, cost or currency (ITN-10)',
    description: 'Send null for time or cost to remove it.',
  })
  @ApiOkResponse({ description: 'The updated itinerary' })
  @ApiBadRequestResponse({ description: 'Nothing to change or invalid fields' })
  @ApiNotFoundResponse({ description: 'Activity not found or not yours' })
  updateActivity(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateActivityDto,
  ) {
    return this.items.updateActivity(user, id, dto);
  }

  @Delete('activities/:id')
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Delete an activity and its images (ITN-10)' })
  @ApiOkResponse({ description: 'The updated itinerary' })
  @ApiNotFoundResponse({ description: 'Activity not found or not yours' })
  removeActivity(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.items.removeActivity(user, id);
  }

  @Post('activities/:id/images')
  @ApiCookieAuth('access_token')
  @UseInterceptors(
    FilesInterceptor('images', MAX_ACTIVITY_IMAGES, {
      limits: { fileSize: MAX_IMAGE_BYTES },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['images'],
      properties: {
        images: { type: 'array', items: { type: 'string', format: 'binary' } },
      },
    },
  })
  @ApiOperation({
    summary:
      'Attach images to an activity: JPG or PNG, max 5 MB each, max 5 per activity (ITN-12, GEN-08)',
  })
  @ApiCreatedResponse({ description: 'All images of the activity' })
  @ApiBadRequestResponse({ description: 'Not JPG/PNG, or more than 5 images in total' })
  @ApiForbiddenResponse({ description: "Someone else's itinerary" })
  @ApiNotFoundResponse({ description: 'Activity not found or not yours' })
  addImages(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFiles() files: UploadedImage[],
  ) {
    return this.items.addImages(user, id, files);
  }

  // 'images/:fileName' (GET) cannot clash with the ':id' routes above, which are PATCH/DELETE/POST
  @Public()
  @Get('activities/images/:fileName')
  @ApiOperation({ summary: 'An activity image file' })
  @ApiOkResponse({ description: 'The JPG or PNG image' })
  @ApiNotFoundResponse({ description: 'Image not found' })
  async image(
    @Param('fileName') fileName: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.items.imageFile(fileName);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    return new StreamableFile(file.data);
  }

  @Delete('activities/:id/images/:imageId')
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Remove an image from an activity (ITN-12)' })
  @ApiOkResponse({ description: 'Remaining images' })
  @ApiNotFoundResponse({ description: 'Activity or image not found' })
  removeImage(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('imageId') imageId: string,
  ) {
    return this.items.removeImage(user, id, imageId);
  }

  // ---------------- Budget entries (ITN-14) ----------------

  @Patch('budgets/:id')
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Edit a budget entry (ITN-14)' })
  @ApiOkResponse({ description: 'The updated itinerary' })
  @ApiBadRequestResponse({ description: 'Nothing to change, negative amount or unsupported currency' })
  @ApiNotFoundResponse({ description: 'Budget entry not found or not yours' })
  updateBudget(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateBudgetDto,
  ) {
    return this.items.updateBudget(user, id, dto);
  }

  @Delete('budgets/:id')
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Delete a budget entry (ITN-14)' })
  @ApiOkResponse({ description: 'The updated itinerary' })
  @ApiNotFoundResponse({ description: 'Budget entry not found or not yours' })
  removeBudget(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.items.removeBudget(user, id);
  }

  // ---------------- Transport costs (ITN-16) ----------------

  @Patch('transport-costs/:id')
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Edit an intercity transport cost (ITN-16)' })
  @ApiOkResponse({ description: 'The updated itinerary' })
  @ApiBadRequestResponse({ description: 'Nothing to change or invalid fields' })
  @ApiNotFoundResponse({ description: 'Transport cost or day not found' })
  updateTransport(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateTransportCostDto,
  ) {
    return this.items.updateTransport(user, id, dto);
  }

  @Delete('transport-costs/:id')
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Delete an intercity transport cost (ITN-16)' })
  @ApiOkResponse({ description: 'The updated itinerary' })
  @ApiNotFoundResponse({ description: 'Transport cost not found or not yours' })
  removeTransport(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.items.removeTransport(user, id);
  }
}
