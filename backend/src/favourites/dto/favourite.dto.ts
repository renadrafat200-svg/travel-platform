import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsMongoId, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { FavouriteType } from '../schemas/favourite.schema';

export class AddFavouriteDto {
  @ApiProperty({ enum: FavouriteType })
  @IsEnum(FavouriteType)
  type: FavouriteType;

  @ApiProperty({ description: 'Id of the hotel, public itinerary or published post' })
  @IsMongoId()
  id: string;
}

export class FavouritesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: FavouriteType, description: 'Only this kind' })
  @IsOptional()
  @IsEnum(FavouriteType)
  type?: FavouriteType;
}
