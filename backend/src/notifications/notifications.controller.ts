import { Controller, Get, Param, Patch, Query } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import { NotificationsQueryDto } from './dto/notifications-query.dto';
import { NotificationsService } from './notifications.service';

/** GEN-01: every logged-in user (any role) sees only their own notifications */
@ApiTags('Notifications')
@ApiCookieAuth('access_token')
@ApiUnauthorizedResponse({ description: 'Not logged in' })
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'My notifications, newest first (GEN-01)' })
  @ApiOkResponse({ description: 'Paginated list (10 per page by default)' })
  findMine(@CurrentUser() user: AuthUser, @Query() query: NotificationsQueryDto) {
    return this.notifications.findMine(user.id, query);
  }

  // Declared before ":id" routes so "unread-count" is never read as an id
  @Get('unread-count')
  @ApiOperation({ summary: 'Number of unread notifications (GEN-01)' })
  @ApiOkResponse({ description: '{ unread: number }' })
  unreadCount(@CurrentUser() user: AuthUser) {
    return this.notifications.unreadCount(user.id);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all my notifications as read (GEN-01)' })
  @ApiOkResponse({ description: '{ marked: number }' })
  markAllRead(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(user.id);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark one notification as read (GEN-01)' })
  @ApiParam({ name: 'id', description: 'Notification id' })
  @ApiOkResponse({ description: 'The notification, now read' })
  @ApiNotFoundResponse({ description: 'No such notification for this user' })
  markRead(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.notifications.markRead(user.id, id);
  }
}
