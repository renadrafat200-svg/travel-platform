import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

/** BLG-06: one like per user per post. The unique index makes double-likes impossible, even in parallel. */
@Schema({
  collection: 'postlikes',
  timestamps: { createdAt: true, updatedAt: false },
})
export class PostLike {
  @Prop({ type: Types.ObjectId, ref: 'Post', required: true })
  post: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user: Types.ObjectId;
}

export const PostLikeSchema = SchemaFactory.createForClass(PostLike);
PostLikeSchema.index({ post: 1, user: 1 }, { unique: true });
