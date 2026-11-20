import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { Equals, IsEmail, IsNotEmpty, IsString, Length, Matches } from 'class-validator';
import { PASSWORD_REGEX, PASSWORD_RULE_MESSAGE } from '../../config/auth.constants';

const toLowerTrim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class RegisterDto {
  @ApiProperty({ example: 'malak@example.com' })
  @Transform(toLowerTrim)
  @IsEmail({}, { message: 'email must be a valid email address' })
  email: string;

  @ApiProperty({ example: 'travel2026', description: PASSWORD_RULE_MESSAGE })
  @IsString()
  @Matches(PASSWORD_REGEX, { message: PASSWORD_RULE_MESSAGE })
  password: string;

  @ApiProperty({ example: true, description: 'ACC-01: the terms-and-privacy consent checkbox; must be true' })
  @Equals(true, { message: 'You must accept the terms and privacy policy' })
  acceptTerms: boolean;

  @ApiProperty({ example: 'Malak' })
  @IsString()
  @Length(1, 50)
  firstName: string;

  @ApiProperty({ example: 'Ehab' })
  @IsString()
  @Length(1, 50)
  lastName: string;
}

export class LoginDto {
  @ApiProperty({ example: 'malak@example.com' })
  @Transform(toLowerTrim)
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Travel2026' })
  @IsString()
  @IsNotEmpty()
  password: string;
}

/** POST /api/auth/forgot-password (ACC-07, optional) */
export class ForgotPasswordDto {
  @ApiProperty({ example: 'malak@example.com' })
  @Transform(toLowerTrim)
  @IsEmail({}, { message: 'email must be a valid email address' })
  email: string;
}

/** POST /api/auth/reset-password (ACC-07, optional) */
export class ResetPasswordDto {
  @ApiProperty({ description: 'The reset code from the email' })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({ example: 'newtravel2026', description: PASSWORD_RULE_MESSAGE })
  @IsString()
  @Matches(PASSWORD_REGEX, { message: PASSWORD_RULE_MESSAGE })
  newPassword: string;
}

export class ChangePasswordDto {
  @ApiProperty({ example: 'Travel2026' })
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @ApiProperty({ example: 'newtravel2026', description: PASSWORD_RULE_MESSAGE })
  @IsString()
  @Matches(PASSWORD_REGEX, { message: PASSWORD_RULE_MESSAGE })
  newPassword: string;
}
