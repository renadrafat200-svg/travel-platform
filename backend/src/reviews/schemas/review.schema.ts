import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { REVIEW_COMMENT_MAX_LENGTH } from '../review.constants';

export type ReviewDocument = HydratedDocument<Review>;

/**
 * HTL-23: one rating (1-5) and an optional comment per Completed hotel reservation,
 * no matter how many rooms the reservation had.
 *
 * Collection name "reviews" and the isHidden flag are what Member 1's reports module
 * (GEN-09 / GEN-10) and Member 4's hotel details page already expect.
 */
@Schema({ collection: 'reviews', timestamps: true })
export class Review {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  user: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Hotel', required: true })
  hotel: Types.ObjectId;

  /** The Completed hotel reservation this review belongs to. Unique: one review per reservation. */
  @Prop({
    type: Types.ObjectId,
    ref: 'HotelBooking',
    required: true,
    unique: true,
  })
  booking: Types.ObjectId;

  @Prop({ required: true, min: 1, max: 5 })
  rating: number;

  @Prop({ trim: true, maxlength: REVIEW_COMMENT_MAX_LENGTH })
  comment?: string;

  /** Set by an admin through the reports module (GEN-10). Hidden reviews don't count in the average. */
  @Prop({ default: false })
  isHidden: boolean;

  @Prop()
  hiddenAt?: Date;

  /** When the author last changed the rating or comment */
  @Prop()
  editedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const ReviewSchema = SchemaFactory.createForClass(Review);

// HTL-24: a hotel's visible reviews, newest first
ReviewSchema.index({ hotel: 1, isHidden: 1, createdAt: -1 });
