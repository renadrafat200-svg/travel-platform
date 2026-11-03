import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class UpdatePreferencesDto {
  @ApiPropertyOptional({ example: 'EGP', description: 'Preferred currency (ISO 4217 code)' })
  @IsOptional()
  @Matches(/^[A-Za-z]{3}$/, { message: 'currency must be a 3-letter code such as EGP or USD' })
  currency?: string;
}

/** Email, role and status cannot be changed here on purpose */
export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Malak' })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Ehab' })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  lastName?: string;

  @ApiPropertyOptional({ example: '+201001234567' })
  @IsOptional()
  @Matches(/^\+?[0-9 ]{7,20}$/, { message: 'phone must contain only digits, spaces and an optional +' })
  phone?: string;

  @ApiPropertyOptional({ example: 'Egyptian' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  nationality?: string;

  @ApiPropertyOptional({ example: '2004-05-17' })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional({ type: UpdatePreferencesDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdatePreferencesDto)
  preferences?: UpdatePreferencesDto;
}
