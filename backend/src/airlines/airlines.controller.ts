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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { MAX_IMAGE_BYTES, type UploadedImage } from '../common/utils/image-upload';
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
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import { AirlinesService } from './airlines.service';
import {
  AirlineQueryDto,
  BaggagePolicyDto,
  CancellationPolicyDto,
  CreateAirlineDto,
  UpdateAirlineDto,
} from './dto/airline.dto';

@ApiTags('Airlines')
@ApiCookieAuth('access_token')
@Controller('airlines')
export class AirlinesController {
  constructor(private readonly airlines: AirlinesService) {}

  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Create an airline (admin only)' })
  @ApiCreatedResponse({
    description: 'Airline created with default policies unless given',
  })
  @ApiBadRequestResponse({
    description: 'Unknown country/currency or IATA code already used',
  })
  @ApiForbiddenResponse({ description: 'Admins only' })
  create(@CurrentUser() admin: AuthUser, @Body() dto: CreateAirlineDto) {
    return this.airlines.create(admin, dto);
  }

  @Get()
  @Public()
  @ApiOperation({ summary: 'List active airlines (public)' })
  @ApiOkResponse({ description: 'Paginated airlines' })
  findAll(@Query() query: AirlineQueryDto, @CurrentUser() user?: AuthUser) {
    return this.airlines.findAll(query, user);
  }

  // Must stay above ':id' so "mine" is not read as an id
  @Get('mine')
  @Roles(Role.AIRLINE_MODERATOR)
  @ApiOperation({ summary: 'The airline I manage (airline moderator)' })
  @ApiOkResponse({ description: 'Your airline, including its policies' })
  @ApiForbiddenResponse({ description: 'Airline moderators only' })
  findMine(@CurrentUser() user: AuthUser) {
    return this.airlines.findMine(user);
  }

  @Get('logos/:fileName')
  @Public()
  @ApiOperation({ summary: 'An airline logo image (public)' })
  @ApiOkResponse({ description: 'The JPG or PNG image' })
  @ApiNotFoundResponse({ description: 'Logo not found' })
  async logo(@Param('fileName') fileName: string, @Res({ passthrough: true }) res: Response) {
    const file = await this.airlines.logoFile(fileName);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return new StreamableFile(file.data);
  }

  @Post(':id/logo')
  @Roles(Role.ADMIN, Role.AIRLINE_MODERATOR)
  @UseInterceptors(FileInterceptor('logo', { limits: { fileSize: MAX_IMAGE_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['logo'],
      properties: { logo: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({
    summary: 'Upload the airline logo: JPG or PNG, max 5 MB, one per airline (FLT-01, GEN-08)',
    description: 'A new upload replaces the previous logo.',
  })
  @ApiOkResponse({ description: '{ logoUrl }' })
  @ApiForbiddenResponse({ description: 'Not your airline' })
  uploadLogo(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFile() file?: UploadedImage,
  ) {
    return this.airlines.uploadLogo(user, id, file);
  }

  @Delete(':id/logo')
  @Roles(Role.ADMIN, Role.AIRLINE_MODERATOR)
  @ApiOperation({ summary: 'Remove the airline logo' })
  @ApiOkResponse({ description: '{ logoUrl: null }' })
  @ApiNotFoundResponse({ description: 'No logo' })
  removeLogo(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.airlines.removeLogo(user, id);
  }

  @Get(':id')
  @Public()
  @ApiOperation({ summary: 'View one airline (public)' })
  @ApiOkResponse({
    description: 'Airline profile with baggage and cancellation policies',
  })
  @ApiNotFoundResponse({ description: 'Not found or deactivated' })
  findOne(@Param('id') id: string, @CurrentUser() user?: AuthUser) {
    return this.airlines.findOne(id, user);
  }

  @Get(':id/policies')
  @Public()
  @ApiOperation({
    summary: "View an airline's baggage and cancellation policies (public)",
  })
  @ApiOkResponse({
    description: 'Baggage allowance, extra bag fee and refund rules',
  })
  @ApiNotFoundResponse({ description: 'Not found or deactivated' })
  getPolicies(@Param('id') id: string, @CurrentUser() user?: AuthUser) {
    return this.airlines.getPolicies(id, user);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.AIRLINE_MODERATOR)
  @ApiOperation({
    summary: 'Edit the airline profile (admin or this airline’s moderator)',
  })
  @ApiOkResponse({ description: 'Updated airline' })
  @ApiForbiddenResponse({ description: 'Not your airline' })
  @ApiNotFoundResponse({ description: 'Airline not found' })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateAirlineDto) {
    return this.airlines.update(user, id, dto);
  }

  @Put(':id/baggage-policy')
  @Roles(Role.ADMIN, Role.AIRLINE_MODERATOR)
  @ApiOperation({
    summary: 'Set the baggage rules (admin or this airline’s moderator)',
  })
  @ApiOkResponse({ description: 'New baggage policy' })
  @ApiForbiddenResponse({ description: 'Not your airline' })
  updateBaggage(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: BaggagePolicyDto,
  ) {
    return this.airlines.updateBaggagePolicy(user, id, dto);
  }

  @Put(':id/cancellation-policy')
  @Roles(Role.ADMIN, Role.AIRLINE_MODERATOR)
  @ApiOperation({
    summary: 'Set the refund rules (admin or this airline’s moderator)',
  })
  @ApiOkResponse({ description: 'New cancellation policy, sorted by hours' })
  @ApiBadRequestResponse({
    description: 'Duplicate hours, or refunds increasing closer to departure',
  })
  @ApiForbiddenResponse({ description: 'Not your airline' })
  updateCancellation(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CancellationPolicyDto,
  ) {
    return this.airlines.updateCancellationPolicy(user, id, dto);
  }
}
