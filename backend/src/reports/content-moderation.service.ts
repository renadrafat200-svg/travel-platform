import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { CONTENT_COLLECTIONS, ReportTargetType } from './reportable-content';

/**
 * Finds, hides and deletes reported content in the teammates' collections
 * (posts, comments, reviews, itineraries) without depending on their modules.
 */
@Injectable()
export class ContentModerationService {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  private collection(type: ReportTargetType) {
    return this.connection.collection(CONTENT_COLLECTIONS[type]);
  }

  async exists(
    type: ReportTargetType,
    id: string | Types.ObjectId,
  ): Promise<boolean> {
    const doc = await this.collection(type).findOne(
      { _id: new Types.ObjectId(id.toString()) },
      { projection: { _id: 1 } },
    );
    return !!doc;
  }

  async assertExists(type: ReportTargetType, id: string | Types.ObjectId) {
    if (!(await this.exists(type, id))) {
      throw new NotFoundException(`That ${type} does not exist`);
    }
  }

  /** Content stays in the database but every public query must skip it */
  async hide(type: ReportTargetType, id: string | Types.ObjectId) {
    const hotel = await this.reviewedHotel(type, id);
    const res = await this.collection(type).updateOne(
      { _id: new Types.ObjectId(id.toString()) },
      { $set: { isHidden: true, hiddenAt: new Date() } },
    );
    if (res.matchedCount === 0)
      throw new NotFoundException(`That ${type} no longer exists`);
    if (hotel) await this.recalculateHotelRating(hotel);
  }

  async remove(type: ReportTargetType, id: string | Types.ObjectId) {
    const hotel = await this.reviewedHotel(type, id);
    const res = await this.collection(type).deleteOne({
      _id: new Types.ObjectId(id.toString()),
    });
    if (res.deletedCount === 0)
      throw new NotFoundException(`That ${type} no longer exists`);
    if (hotel) await this.recalculateHotelRating(hotel);
  }

  /** For a review: the hotel it belongs to (so its average rating can be updated) */
  private async reviewedHotel(
    type: ReportTargetType,
    id: string | Types.ObjectId,
  ): Promise<Types.ObjectId | undefined> {
    if (type !== ReportTargetType.REVIEW) return undefined;
    const review = await this.collection(type).findOne(
      { _id: new Types.ObjectId(id.toString()) },
      { projection: { hotel: 1 } },
    );
    return review?.hotel as Types.ObjectId | undefined;
  }

  /**
   * HTL-23: hidden or deleted reviews no longer count, so the hotel's averageRating and
   * reviewCount (used by Member 4's search) are recomputed from the visible reviews.
   * Same rounding as ReviewsService / HotelsService.setRating.
   */
  private async recalculateHotelRating(hotelId: Types.ObjectId) {
    const [row] = await this.collection(ReportTargetType.REVIEW)
      .aggregate<{ avg: number; count: number }>([
        { $match: { hotel: hotelId, isHidden: { $ne: true } } },
        { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
      ])
      .toArray();
    await this.connection.collection('hotels').updateOne(
      { _id: hotelId },
      {
        $set: {
          averageRating: row ? Math.round(row.avg * 10) / 10 : 0,
          reviewCount: row?.count ?? 0,
        },
      },
    );
  }
}
