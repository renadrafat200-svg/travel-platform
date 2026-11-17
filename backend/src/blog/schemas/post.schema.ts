import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { PostStatus } from '../blog.constants';

export type PostDocument = HydratedDocument<Post>;

@Schema({
  _id: true,
  timestamps: { createdAt: 'uploadedAt', updatedAt: false },
})
export class PostImage {
  _id: Types.ObjectId;

  /** Name of the image in the postimagefiles collection */
  @Prop({ required: true })
  fileName: string;

  @Prop({ required: true })
  url: string;

  @Prop({ required: true })
  contentType: string;

  @Prop({ required: true })
  size: number;

  uploadedAt: Date;
}
export const PostImageSchema = SchemaFactory.createForClass(PostImage);

/**
 * BLG-01: a blog post, Draft or Published.
 * Collection "posts" and isHidden are what Member 1's reports module (GEN-09 / GEN-10) expects.
 * likeCount and commentCount are kept up to date so search can order by interaction score (BLG-09).
 */
@Schema({ collection: 'posts', timestamps: true })
export class Post {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  author: Types.ObjectId;

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ required: true })
  body: string;

  /** Lower-case, unique, max 5 (BLG-08) */
  @Prop({ type: [String], default: [], index: true })
  tags: string[];

  @Prop({ type: [PostImageSchema], default: [] })
  images: PostImage[];

  @Prop({
    type: String,
    enum: PostStatus,
    default: PostStatus.DRAFT,
    index: true,
  })
  status: PostStatus;

  /** First time the post was published; the date shown on the post */
  @Prop()
  publishedAt?: Date;

  @Prop({ default: 0 })
  likeCount: number;

  /** Visible (not hidden) comments only */
  @Prop({ default: 0 })
  commentCount: number;

  /** Set by an admin through the reports module. Hidden posts are visible only to the author and admins. */
  @Prop({ default: false })
  isHidden: boolean;

  @Prop()
  hiddenAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const PostSchema = SchemaFactory.createForClass(Post);
PostSchema.index({ status: 1, isHidden: 1, publishedAt: -1 });
