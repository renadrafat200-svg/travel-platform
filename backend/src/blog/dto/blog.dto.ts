import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import {
  COMMENT_MAX_LENGTH,
  MAX_TAGS,
  POST_BODY_MAX_LENGTH,
  POST_TITLE_MAX_LENGTH,
  PostStatus,
  TAG_MAX_LENGTH,
} from '../blog.constants';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Tags are trimmed, lower-cased, a leading # removed, empty ones and duplicates dropped */
const normalizeTags = ({ value }: { value: unknown }) => {
  if (!Array.isArray(value)) return value;
  const out: unknown[] = [];
  for (const t of value) {
    const tag =
      typeof t === 'string' ? t.trim().replace(/^#+/, '').toLowerCase() : t;
    if (tag === '' || out.includes(tag)) continue;
    out.push(tag);
  }
  return out;
};

export class CreatePostDto {
  @ApiProperty({ maxLength: POST_TITLE_MAX_LENGTH })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Title is required' })
  @MaxLength(POST_TITLE_MAX_LENGTH)
  title: string;

  @ApiProperty({ maxLength: POST_BODY_MAX_LENGTH })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Body is required' })
  @MaxLength(POST_BODY_MAX_LENGTH)
  body: string;

  @ApiPropertyOptional({
    type: [String],
    maxItems: MAX_TAGS,
    description: `Up to ${MAX_TAGS} tags, max ${TAG_MAX_LENGTH} characters each (stored in lower case)`,
  })
  @IsOptional()
  @Transform(normalizeTags)
  @IsArray()
  @ArrayMaxSize(MAX_TAGS, {
    message: `A post can have at most ${MAX_TAGS} tags`,
  })
  @IsString({ each: true })
  @MaxLength(TAG_MAX_LENGTH, {
    each: true,
    message: `Each tag can be at most ${TAG_MAX_LENGTH} characters`,
  })
  tags?: string[];

  @ApiPropertyOptional({
    enum: PostStatus,
    default: PostStatus.DRAFT,
    description: 'draft = only you can see it; published = public',
  })
  @IsOptional()
  @IsEnum(PostStatus)
  status?: PostStatus;
}

/** BLG-04 / BLG-08: change any field; status can go draft -> published or back to draft */
export class UpdatePostDto extends PartialType(CreatePostDto) {}

/** PATCH /api/posts/:id/itinerary (BLG-13, optional) */
export class AttachItineraryDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Id of one of my PUBLIC itineraries, or null to remove it from the post',
  })
  @IsOptional()
  @IsMongoId({ message: 'itineraryId must be an itinerary id (or null to remove it)' })
  itineraryId: string | null;
}

export class PostListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Only posts with this tag (BLG-02)' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value.trim().replace(/^#+/, '').toLowerCase()
      : value,
  )
  @IsString()
  tag?: string;

  @ApiPropertyOptional({
    description:
      'Keyword searched in title, tags and author name (BLG-09). Results are ordered by likes + comments, newest first on ties.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class TagPostsQueryDto extends PaginationQueryDto {}

export class CreateCommentDto {
  @ApiProperty({ maxLength: COMMENT_MAX_LENGTH })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'A comment cannot be empty' })
  @MaxLength(COMMENT_MAX_LENGTH, {
    message: `A comment can be at most ${COMMENT_MAX_LENGTH} characters`,
  })
  body: string;
}

export class UpdateCommentDto extends CreateCommentDto {}
