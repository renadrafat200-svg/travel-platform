import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
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
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import { AcceptPoliciesDto, BookingParamsDto } from './dto/policies.dto';
import { PoliciesService } from './policies.service';

@ApiTags('Payments')
@ApiCookieAuth('access_token')
@Controller('bookings')
export class PoliciesController {
  constructor(private readonly policies: PoliciesService) {}

  @Get(':type/:id/policies')
  @ApiOperation({
    summary: "Provider policies to accept before paying (PAY-02)",
    description:
      'flight: each airline\'s cancellation and baggage policies. hotel: cancellation tiers and check-in/check-out times. Also says whether they were already accepted.',
  })
  @ApiOkResponse({ description: 'Policies + accepted / acceptedAt' })
  @ApiForbiddenResponse({ description: 'Not your booking' })
  @ApiNotFoundResponse({ description: 'Booking not found' })
  getPolicies(@CurrentUser() user: AuthUser, @Param() params: BookingParamsDto) {
    return this.policies.getPolicies(user, params.type, params.id);
  }

  @Post(':type/:id/accept-policies')
  @HttpCode(200)
  @ApiOperation({
    summary: "Accept the provider's policies (PAY-02)",
    description: 'Required before POST /api/payments. The acceptance is stored with a timestamp.',
  })
  @ApiOkResponse({ description: '{ accepted: true, acceptedAt }' })
  @ApiBadRequestResponse({ description: 'accepted is not true, or the booking is not pending payment' })
  @ApiForbiddenResponse({ description: 'Not your booking' })
  accept(
    @CurrentUser() user: AuthUser,
    @Param() params: BookingParamsDto,
    @Body() _dto: AcceptPoliciesDto,
  ) {
    return this.policies.accept(user, params.type, params.id);
  }
}
