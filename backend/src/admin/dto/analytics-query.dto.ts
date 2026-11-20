import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';

/** GET /api/admin/analytics (optional bonus) */
export class AnalyticsQueryDto {
  @ApiPropertyOptional({ description: 'Start date (YYYY-MM-DD). Default: 30 days ago' })
  @IsOptional()
  @IsDateString({}, { message: 'from must be a date like 2026-11-01' })
  from?: string;

  @ApiPropertyOptional({ description: 'End date, included (YYYY-MM-DD). Default: today' })
  @IsOptional()
  @IsDateString({}, { message: 'to must be a date like 2026-11-30' })
  to?: string;
}
