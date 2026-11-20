import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import { RefundsService } from './refunds.service';

@ApiTags('Payments')
@ApiCookieAuth('access_token')
@Controller('refunds')
export class RefundsController {
  constructor(private readonly refunds: RefundsService) {}

  @Get()
  @ApiOperation({ summary: 'My refunds, newest first (PAY-03)' })
  @ApiOkResponse({ description: 'Paginated list' })
  findMine(@CurrentUser() user: AuthUser, @Query() query: PaginationQueryDto) {
    return this.refunds.findMine(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Refund status: pending, refunded or failed (PAY-03). Owner or admin.' })
  @ApiParam({ name: 'id', description: 'Refund id' })
  @ApiOkResponse({ description: 'The refund' })
  @ApiForbiddenResponse({ description: 'Not your refund' })
  @ApiNotFoundResponse({ description: 'Refund not found' })
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.refunds.findOne(user, id);
  }
}
