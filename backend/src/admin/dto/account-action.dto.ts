import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Optional reason, saved in the audit log */
export class AccountActionDto {
  @ApiPropertyOptional({ example: 'Repeated spam posts' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}