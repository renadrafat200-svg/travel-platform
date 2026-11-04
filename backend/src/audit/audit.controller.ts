import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { AuditService } from './audit.service';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';

@ApiTags('Admin')
@ApiCookieAuth('access_token')
@Roles(Role.ADMIN) // every route in this controller is admin-only
@Controller('admin/audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @ApiOperation({ summary: 'View the audit log of administrative actions (GEN-07)' })
  @ApiOkResponse({ description: 'Paginated list, newest first' })
  @ApiForbiddenResponse({ description: 'Admins only' })
  findAll(@Query() query: AuditLogQueryDto) {
    return this.audit.findAll(query);
  }
}