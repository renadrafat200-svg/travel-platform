import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

/**
 * BLG-10 / GEN-08: the bytes of a post image, kept in the shared database (like hotel photos)
 * so every teammate's backend can show the same images. Max 5 MB, under MongoDB's 16 MB limit.
 */
@Schema({
  collection: 'postimagefiles',
  timestamps: { createdAt: true, updatedAt: false },
})
export class PostImageFile {
  @Prop({ required: true, unique: true })
  fileName: string;

  @Prop({ type: Types.ObjectId, ref: 'Post', required: true, index: true })
  post: Types.ObjectId;

  @Prop({ required: true })
  contentType: string;

  @Prop({ required: true })
  size: number;

  @Prop({ type: Buffer, required: true })
  data: Buffer;
}

export const PostImageFileSchema = SchemaFactory.createForClass(PostImageFile);
