import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { COMMENT_MAX_LENGTH } from '../blog.constants';

export type CommentDocument = HydratedDocument<Comment>;

/** BLG-05: a comment on a published post. Collection "comments" + isHidden match Member 1's reports module. */
@Schema({ collection: 'comments', timestamps: true })
export class Comment {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Post', required: true })
  post: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  author: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: COMMENT_MAX_LENGTH })
  body: string;

  @Prop()
  editedAt?: Date;

  @Prop({ default: false })
  isHidden: boolean;

  @Prop()
  hiddenAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const CommentSchema = SchemaFactory.createForClass(Comment);
// Comments on a post in chronological order
CommentSchema.index({ post: 1, createdAt: 1 });
