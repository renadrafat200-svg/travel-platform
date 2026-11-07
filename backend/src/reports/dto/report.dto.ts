import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { ReportTargetType } from '../reportable-content';
import { ReportReason, ReportStatus } from '../schemas/report.schema';

/** POST /api/reports — any logged-in user */
export class CreateReportDto {
  @ApiProperty({ enum: ReportTargetType, example: ReportTargetType.POST })
  @IsEnum(ReportTargetType)
  targetType: ReportTargetType;

  @ApiProperty({ example: '6a0eb842da554c99a192cf0b', description: 'Id of the post/comment/review/itinerary' })
  @IsMongoId()
  targetId: string;

  @ApiProperty({ enum: ReportReason, example: ReportReason.SPAM })
  @IsEnum(ReportReason)
  reason: ReportReason;

  @ApiPropertyOptional({ example: 'This post is advertising an unrelated product.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  details?: string;
}

/** GET /api/admin/reports filters */
export class ReportQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ReportStatus, example: ReportStatus.OPEN })
  @IsOptional()
  @IsEnum(ReportStatus)
  status?: ReportStatus;

  @ApiPropertyOptional({ enum: ReportTargetType })
  @IsOptional()
  @IsEnum(ReportTargetType)
  targetType?: ReportTargetType;
}

export enum ReportAction {
  DISMISS = 'dismiss',
  HIDE = 'hide',
  DELETE = 'delete',
}

/** PATCH /api/admin/reports/:id — what the admin decides */
export class ResolveReportDto {
  @ApiProperty({
    enum: ReportAction,
    description: 'dismiss = content is fine; hide = keep it but hide it from everyone; delete = remove it',
  })
  @IsEnum(ReportAction)
  action: ReportAction;

  @ApiPropertyOptional({ example: 'Confirmed spam' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}