import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { AccountStatus, Role } from '../../common/enums/role.enum';

/** ACC-14: filters for GET /api/admin/accounts */
export class AccountQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: Role })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiPropertyOptional({ enum: AccountStatus })
  @IsOptional()
  @IsEnum(AccountStatus)
  status?: AccountStatus;

  @ApiPropertyOptional({ description: 'Search by email, first name or last name', example: 'malak' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}