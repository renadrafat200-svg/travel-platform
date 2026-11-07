import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class AirportQueryDto {
  @ApiPropertyOptional({ description: 'Search by IATA code, airport name or city', example: 'cai' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ example: 'cairo' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: 'EG' })
  @IsOptional()
  @IsString()
  country?: string;
}

export class CityQueryDto {
  @ApiPropertyOptional({ example: 'EG' })
  @IsOptional()
  @IsString()
  country?: string;
}

export class AttractionQueryDto {
  @ApiPropertyOptional({ example: 'cairo' })
  @IsOptional()
  @IsString()
  city?: string;
}
