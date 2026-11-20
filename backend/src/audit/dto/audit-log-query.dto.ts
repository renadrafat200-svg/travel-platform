import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsMongoId, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

/** Filters for GET /api/admin/audit-logs, plus page/limit from PaginationQueryDto */
export class AuditLogQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Only this action, e.g. account.suspend or report.dismiss' })
  @IsOptional()
  @IsString()
  action?: string;

  @ApiPropertyOptional({ description: 'Only actions done by this user id' })
  @IsOptional()
  @IsMongoId()
  actorId?: string;

  @ApiPropertyOptional({ description: 'Only this kind of target, e.g. user, report, post' })
  @IsOptional()
  @IsString()
  targetType?: string;

  @ApiPropertyOptional({ description: 'From this date (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Up to this date (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  to?: string;
}