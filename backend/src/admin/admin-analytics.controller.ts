import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { AdminAnalyticsService } from './admin-analytics.service';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';

@ApiTags('Admin')
@ApiCookieAuth('access_token')
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminAnalyticsController {
  constructor(private readonly analytics: AdminAnalyticsService) {}

  @Get('analytics')
  @ApiOperation({
    summary: 'Admin analytics dashboard (optional bonus)',
    description:
      'Users, bookings by status and per day, revenue and refunds (Stripe payments, USD), top destinations / hotels / airlines, and content and moderation counts, for ?from=&to= (default: the last 30 days).',
  })
  @ApiOkResponse({ description: '{ period, users, bookings, revenue, top, content }' })
  @ApiBadRequestResponse({ description: 'Invalid dates or period longer than a year' })
  @ApiForbiddenResponse({ description: 'Admins only' })
  dashboard(@Query() query: AnalyticsQueryDto) {
    return this.analytics.dashboard(query);
  }
}
