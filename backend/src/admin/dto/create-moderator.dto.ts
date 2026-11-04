import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsMongoId, IsString, Length, Matches } from 'class-validator';
import { ProviderType } from '../../common/enums/role.enum';
import { PASSWORD_REGEX, PASSWORD_RULE_MESSAGE } from '../../config/auth.constants';

/** ACC-13: an admin creates a moderator and assigns exactly one airline or hotel */
export class CreateModeratorDto {
  @ApiProperty({ example: 'egyptair.mod@travel.local' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Moderator2026', description: PASSWORD_RULE_MESSAGE })
  @IsString()
  @Matches(PASSWORD_REGEX, { message: PASSWORD_RULE_MESSAGE })
  password: string;

  @ApiProperty({ example: 'Omar' })
  @IsString()
  @Length(1, 50)
  firstName: string;

  @ApiProperty({ example: 'Hassan' })
  @IsString()
  @Length(1, 50)
  lastName: string;

  @ApiProperty({ enum: ProviderType, example: ProviderType.AIRLINE })
  @IsEnum(ProviderType)
  providerType: ProviderType;

  @ApiProperty({ example: '6a0eb842da554c99a192cf0b', description: 'Id of the airline or hotel' })
  @IsMongoId()
  providerId: string;
}