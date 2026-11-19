import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import {
  MAX_IMAGE_BYTES,
  type UploadedImage,
} from '../common/utils/image-upload';
import { MAX_POST_IMAGES } from './blog.constants';
import { BlogService } from './blog.service';
import {
  CreateCommentDto,
  CreatePostDto,
  PostListQueryDto,
  TagPostsQueryDto,
  UpdateCommentDto,
  AttachItineraryDto,
  UpdatePostDto,
} from './dto/blog.dto';

/**
 * Blog (BLG-01 to BLG-10, BLG-12). Paths are exactly the ones in the project PDF (section 8.9),
 * so this controller has no common prefix.
 */
@ApiTags('Blog')
@Controller()
export class BlogController {
  constructor(private readonly blog: BlogService) {}

  // ---------------- Posts ----------------

  @Post('posts')
  @Roles(Role.USER)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Create a post, as draft or published (BLG-01, BLG-08)',
    description:
      'Title and body required; up to 5 tags (max 30 characters each). Images: POST /api/posts/{id}/images.',
  })
  @ApiCreatedResponse({ description: 'The new post' })
  @ApiBadRequestResponse({
    description:
      'Missing title/body, more than 5 tags, or a tag over 30 characters',
  })
  @ApiUnauthorizedResponse({ description: 'Not logged in' })
  createPost(@CurrentUser() user: AuthUser, @Body() dto: CreatePostDto) {
    return this.blog.createPost(user, dto);
  }

  @Public()
  @Get('posts')
  @ApiOperation({
    summary: 'Browse or search published posts (public) (BLG-02, BLG-09)',
    description:
      'Without q: newest first, optional tag filter. With q: keyword in title, tags or author name, ' +
      'ordered by likes + comments (newest first on ties). Empty items = "no results".',
  })
  @ApiOkResponse({
    description:
      'Paginated list: title, excerpt, author, date, tags, likeCount, commentCount',
  })
  listPublished(@Query() query: PostListQueryDto) {
    return this.blog.listPublished(query);
  }

  // 'mine' and 'images/...' must stay above ':id' so they are not read as ids
  @Get('posts/mine')
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary:
      'My posts, drafts included: title, status, date, likes, comments (BLG-03)',
  })
  @ApiOkResponse({ description: 'Paginated list of my posts' })
  @ApiUnauthorizedResponse({ description: 'Not logged in' })
  listMine(@CurrentUser() user: AuthUser, @Query() query: PaginationQueryDto) {
    return this.blog.listMine(user, query);
  }

  @Public()
  @Get('posts/images/:fileName')
  @ApiOperation({ summary: 'A post image file (public)' })
  @ApiOkResponse({ description: 'The JPG or PNG image' })
  @ApiNotFoundResponse({ description: 'Image not found' })
  async image(
    @Param('fileName') fileName: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.blog.imageFile(fileName);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return new StreamableFile(file.data);
  }

  @Public()
  @Get('posts/:id')
  @ApiOperation({
    summary:
      'A post page: title, author, date, body, tags, images, likes and comments (public) (BLG-02)',
    description:
      'Drafts and hidden posts are visible only to their author and admins.',
  })
  @ApiOkResponse({
    description: 'The post with its comments in chronological order',
  })
  @ApiNotFoundResponse({
    description: 'Post not found (or a draft/hidden post of someone else)',
  })
  getPost(@Param('id') id: string, @CurrentUser() user?: AuthUser) {
    return this.blog.getPost(user, id);
  }

  @Patch('posts/:id')
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Edit my post: title, body, tags or status (BLG-04, BLG-08)',
  })
  @ApiOkResponse({ description: 'The updated post' })
  @ApiBadRequestResponse({ description: 'Nothing to change or invalid fields' })
  @ApiForbiddenResponse({ description: 'Not your post' })
  @ApiNotFoundResponse({ description: 'Post not found' })
  updatePost(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdatePostDto,
  ) {
    return this.blog.updatePost(user, id, dto);
  }

  @Patch('posts/:id/itinerary')
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Attach one of my public itineraries to my post, or remove it with null (BLG-13, optional)',
    description:
      'Readers see the itinerary (title, countries, dates, days) on the post and can open or clone it. It disappears from the post if the itinerary becomes private or hidden.',
  })
  @ApiOkResponse({ description: 'The post with its itinerary' })
  @ApiBadRequestResponse({ description: 'The itinerary is not public, or nothing to remove' })
  @ApiForbiddenResponse({ description: 'Not your post' })
  @ApiNotFoundResponse({ description: 'Post not found, or not one of my itineraries' })
  attachItinerary(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: AttachItineraryDto,
  ) {
    return this.blog.attachItinerary(user, id, dto);
  }

  @Delete('posts/:id')
  @HttpCode(204)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary:
      'Delete my post with its comments, likes and images (BLG-04). Admins can delete any post.',
  })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiForbiddenResponse({ description: 'Not your post' })
  @ApiNotFoundResponse({ description: 'Post not found' })
  deletePost(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.blog.deletePost(user, id);
  }

  // ---------------- Comments ----------------

  @Post('posts/:id/comments')
  @Roles(Role.USER)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary:
      'Comment on a published post: not empty, max 500 characters (BLG-05)',
  })
  @ApiCreatedResponse({ description: 'The new comment' })
  @ApiBadRequestResponse({ description: 'Empty or longer than 500 characters' })
  @ApiUnauthorizedResponse({ description: 'Not logged in' })
  @ApiNotFoundResponse({ description: 'Post not found or not published' })
  addComment(
    @CurrentUser() user: AuthUser,
    @Param('id') postId: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.blog.addComment(user, postId, dto);
  }

  @Patch('comments/:id')
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Edit my comment (BLG-07)' })
  @ApiOkResponse({ description: 'The updated comment' })
  @ApiBadRequestResponse({ description: 'Empty or longer than 500 characters' })
  @ApiForbiddenResponse({ description: 'Not your comment' })
  @ApiNotFoundResponse({ description: 'Comment not found' })
  updateComment(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateCommentDto,
  ) {
    return this.blog.updateComment(user, id, dto);
  }

  @Delete('comments/:id')
  @HttpCode(204)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Delete my comment (BLG-07). Admins can delete any comment.',
  })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiForbiddenResponse({ description: 'Not your comment' })
  @ApiNotFoundResponse({ description: 'Comment not found' })
  deleteComment(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.blog.deleteComment(user, id);
  }

  // ---------------- Likes ----------------

  @Post('posts/:id/like')
  @HttpCode(200)
  @Roles(Role.USER)
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Like a post, once per user (BLG-06)' })
  @ApiOkResponse({ description: '{ liked: true, likeCount }' })
  @ApiConflictResponse({ description: 'You already liked this post' })
  @ApiNotFoundResponse({ description: 'Post not found or not published' })
  like(@CurrentUser() user: AuthUser, @Param('id') postId: string) {
    return this.blog.like(user, postId);
  }

  @Delete('posts/:id/like')
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Remove my like (BLG-06)' })
  @ApiOkResponse({ description: '{ liked: false, likeCount }' })
  @ApiNotFoundResponse({
    description: "Post not found, or you haven't liked it",
  })
  unlike(@CurrentUser() user: AuthUser, @Param('id') postId: string) {
    return this.blog.unlike(user, postId);
  }

  // ---------------- Images ----------------

  @Post('posts/:id/images')
  @ApiCookieAuth('access_token')
  @UseInterceptors(
    FilesInterceptor('images', MAX_POST_IMAGES, {
      limits: { fileSize: MAX_IMAGE_BYTES },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['images'],
      properties: {
        images: { type: 'array', items: { type: 'string', format: 'binary' } },
      },
    },
  })
  @ApiOperation({
    summary:
      'Add images to my post: JPG or PNG, max 5 MB each, max 5 per post (BLG-10, GEN-08)',
  })
  @ApiCreatedResponse({ description: 'All images of the post' })
  @ApiBadRequestResponse({
    description: 'Not JPG/PNG, or more than 5 images in total',
  })
  @ApiForbiddenResponse({ description: 'Not your post' })
  addImages(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFiles() files: UploadedImage[],
  ) {
    return this.blog.addImages(user, id, files);
  }

  @Delete('posts/:id/images/:imageId')
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Remove an image from my post (BLG-10)' })
  @ApiOkResponse({ description: 'Remaining images' })
  @ApiForbiddenResponse({ description: 'Not your post' })
  @ApiNotFoundResponse({ description: 'Post or image not found' })
  removeImage(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('imageId') imageId: string,
  ) {
    return this.blog.removeImage(user, id, imageId);
  }

  // ---------------- Tags and authors ----------------

  @Public()
  @Get('tags/:tag/posts')
  @ApiOperation({
    summary: 'Published posts with this tag, newest first (public) (BLG-08)',
  })
  @ApiOkResponse({ description: 'Paginated list of posts' })
  listByTag(@Param('tag') tag: string, @Query() query: TagPostsQueryDto) {
    return this.blog.listByTag(tag, query);
  }

  @Public()
  @Get('authors/:id')
  @ApiOperation({
    summary:
      "An author's public page: name, join date, published posts and public itineraries (BLG-12)",
  })
  @ApiOkResponse({
    description: '{ id, name, joinedAt, posts (paginated), publicItineraries }',
  })
  @ApiNotFoundResponse({ description: 'Author not found' })
  authorPage(@Param('id') id: string, @Query() query: PaginationQueryDto) {
    return this.blog.authorPage(id, query);
  }
}
