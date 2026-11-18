import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class NotificationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'true = only notifications that were not read yet' })
  @IsOptional()
  @Transform(({ obj }) => {
    const raw = (obj as Record<string, unknown>).unreadOnly;
    return raw === true || raw === 'true' || raw === '1';
  })
  @IsBoolean()
  unreadOnly?: boolean;
}
