import { Body, Controller, Delete, Get, HttpCode, Param, ParseEnumPipe, Patch, Post, Query } from '@nestjs/common';
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
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import { CreateReportDto, ReportQueryDto, ResolveReportDto } from './dto/report.dto';
import { ReportTargetType } from './reportable-content';
import { ReportsService } from './reports.service';

/** Users report content */
@ApiTags('Reports')
@ApiCookieAuth('access_token')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post()
  @ApiOperation({ summary: 'Report a post, comment, review or itinerary' })
  @ApiCreatedResponse({ description: 'Report submitted' })
  @ApiNotFoundResponse({ description: 'That content does not exist' })
  @ApiConflictResponse({ description: 'You already reported it and it is still open' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateReportDto) {
    return this.reports.create(user, dto);
  }
}

/** Admins review reports and moderate content */
@ApiTags('Admin')
@ApiCookieAuth('access_token')
@ApiForbiddenResponse({ description: 'Admins only' })
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('reports')
  @ApiOperation({ summary: 'List reports, newest first (GEN-09, GEN-10)' })
  @ApiOkResponse({ description: 'Paginated reports; filter status=open for the to-do list' })
  findAll(@Query() query: ReportQueryDto) {
    return this.reports.findAll(query);
  }

  @Patch('reports/:id')
  @ApiOperation({ summary: 'Handle a report: dismiss, hide the content, or delete it (GEN-10)' })
  @ApiOkResponse({ description: 'Report handled; recorded in the audit log' })
  @ApiBadRequestResponse({ description: 'Report already handled' })
  @ApiNotFoundResponse({ description: 'Report or content not found' })
  resolve(@CurrentUser() admin: AuthUser, @Param('id') id: string, @Body() dto: ResolveReportDto) {
    return this.reports.resolve(admin, id, dto);
  }

  @Delete('content/:type/:id')
  @HttpCode(204)
  @ApiParam({ name: 'type', enum: ReportTargetType })
  @ApiOperation({ summary: 'Delete inappropriate content directly (GEN-10)' })
  @ApiNoContentResponse({ description: 'Deleted; open reports about it are closed' })
  @ApiNotFoundResponse({ description: 'Content not found' })
  deleteContent(
    @CurrentUser() admin: AuthUser,
    @Param('type', new ParseEnumPipe(ReportTargetType)) type: ReportTargetType,
    @Param('id') id: string,
  ) {
    return this.reports.deleteContent(admin, type, id);
  }
}