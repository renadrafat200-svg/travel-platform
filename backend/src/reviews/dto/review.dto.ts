import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import {
  MAX_RATING,
  MIN_RATING,
  REPLY_MAX_LENGTH,
  REVIEW_COMMENT_MAX_LENGTH,
} from '../review.constants';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateReviewDto {
  @ApiProperty({
    minimum: MIN_RATING,
    maximum: MAX_RATING,
    description: 'Whole number from 1 to 5',
  })
  @IsInt({ message: 'rating must be a whole number from 1 to 5' })
  @Min(MIN_RATING, { message: 'rating must be a whole number from 1 to 5' })
  @Max(MAX_RATING, { message: 'rating must be a whole number from 1 to 5' })
  rating: number;

  @ApiPropertyOptional({
    maxLength: REVIEW_COMMENT_MAX_LENGTH,
    description: 'Optional review text',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(REVIEW_COMMENT_MAX_LENGTH, {
    message: `The review can be at most ${REVIEW_COMMENT_MAX_LENGTH} characters`,
  })
  comment?: string;
}

export class UpdateReviewDto {
  @ApiPropertyOptional({ minimum: MIN_RATING, maximum: MAX_RATING })
  @IsOptional()
  @IsInt({ message: 'rating must be a whole number from 1 to 5' })
  @Min(MIN_RATING, { message: 'rating must be a whole number from 1 to 5' })
  @Max(MAX_RATING, { message: 'rating must be a whole number from 1 to 5' })
  rating?: number;

  @ApiPropertyOptional({
    maxLength: REVIEW_COMMENT_MAX_LENGTH,
    description:
      'New review text. Send an empty string to remove the text and keep only the rating.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(REVIEW_COMMENT_MAX_LENGTH, {
    message: `The review can be at most ${REVIEW_COMMENT_MAX_LENGTH} characters`,
  })
  comment?: string;
}

/** HTL-26 (optional): POST / PATCH /api/reviews/:id/reply */
export class ReviewReplyDto {
  @ApiProperty({
    maxLength: REPLY_MAX_LENGTH,
    example: 'Thank you for staying with us! We are glad you enjoyed the view.',
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'The reply cannot be empty' })
  @MaxLength(REPLY_MAX_LENGTH, {
    message: `The reply can be at most ${REPLY_MAX_LENGTH} characters`,
  })
  text: string;
}

/** HTL-24: page through a hotel's reviews (always newest first) */
export class HotelReviewsQueryDto extends PaginationQueryDto {}
