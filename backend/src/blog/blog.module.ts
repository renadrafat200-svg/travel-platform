import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import { BlogController } from './blog.controller';
import { BlogService } from './blog.service';
import { Comment, CommentSchema } from './schemas/comment.schema';
import {
  PostImageFile,
  PostImageFileSchema,
} from './schemas/post-image-file.schema';
import { PostLike, PostLikeSchema } from './schemas/post-like.schema';
import { Post, PostSchema } from './schemas/post.schema';

/**
 * Member 5: blog and community (BLG-01 to BLG-10, BLG-12).
 * Collections "posts" and "comments" with isHidden are what Member 1's reports module moderates.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Post.name, schema: PostSchema },
      { name: Comment.name, schema: CommentSchema },
      { name: PostLike.name, schema: PostLikeSchema },
      { name: PostImageFile.name, schema: PostImageFileSchema },
    ]),
    UsersModule,
  ],
  controllers: [BlogController],
  providers: [BlogService],
  exports: [BlogService],
})
export class BlogModule {}
