import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import { paginate } from '../common/dto/pagination-query.dto';
import { Role } from '../common/enums/role.enum';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import { HotelBookingsService } from '../hotel-bookings/hotel-bookings.service';
import { HotelsService } from '../hotels/hotels.service';
import {
  CreateReviewDto,
  HotelReviewsQueryDto,
  UpdateReviewDto,
} from './dto/review.dto';
import { Review, ReviewDocument } from './schemas/review.schema';

type PopulatedUser = {
  _id: Types.ObjectId;
  firstName?: string;
  lastName?: string;
};

/**
 * HTL-23 / HTL-24: hotel reviews.
 * - Only after a Completed reservation of your own (Member 4's getCompletedStay checks that).
 * - One review per reservation, whatever the number of rooms.
 * - The author can edit or delete it later; an admin can delete it too.
 * - After every change the hotel's averageRating and reviewCount are recalculated,
 *   which is what Member 4's hotel search sorts and filters by.
 */
@Injectable()
export class ReviewsService {
  constructor(
    @InjectModel(Review.name) private readonly reviewModel: Model<Review>,
    private readonly bookings: HotelBookingsService,
    private readonly hotels: HotelsService,
    private readonly audit: AuditService,
  ) {}

  /** HTL-23: POST /api/hotel-bookings/:id/review */
  async create(user: AuthUser, bookingId: string, dto: CreateReviewDto) {
    // 404 if the reservation doesn't exist, 403 if not yours, 400 if not Completed yet
    const stay = await this.bookings.getCompletedStay(user, bookingId);

    if (await this.reviewModel.exists({ booking: stay.bookingId })) {
      throw new ConflictException(
        'You already reviewed this reservation. Edit your review instead.',
      );
    }

    let review: ReviewDocument;
    try {
      review = await this.reviewModel.create({
        user: new Types.ObjectId(user.id),
        hotel: new Types.ObjectId(stay.hotelId),
        booking: new Types.ObjectId(stay.bookingId),
        rating: dto.rating,
        comment: dto.comment || undefined,
      });
    } catch (err) {
      // Two requests at the same moment: the unique index lets only one through
      if ((err as { code?: number }).code === 11000) {
        throw new ConflictException(
          'You already reviewed this reservation. Edit your review instead.',
        );
      }
      throw err;
    }

    await this.recalculateHotelRating(review.hotel);
    return this.toView(await this.populate(review));
  }

  /** HTL-23: PATCH /api/reviews/:id (author only) */
  async update(user: AuthUser, id: string, dto: UpdateReviewDto) {
    const review = await this.getById(id);
    if (!review.user.equals(user.id)) {
      throw new NotFoundException('Review not found');
    }
    if (dto.rating === undefined && dto.comment === undefined) {
      throw new BadRequestException(
        'Send a new rating, a new comment, or both',
      );
    }

    if (dto.rating !== undefined) review.rating = dto.rating;
    if (dto.comment !== undefined) review.comment = dto.comment || undefined;
    review.editedAt = new Date();
    await review.save();

    await this.recalculateHotelRating(review.hotel);
    return this.toView(await this.populate(review));
  }

  /** HTL-23: DELETE /api/reviews/:id (author, or an admin) */
  async remove(user: AuthUser, id: string) {
    const review = await this.getById(id);
    if (user.role !== Role.ADMIN && !review.user.equals(user.id)) {
      throw new NotFoundException('Review not found');
    }

    await this.reviewModel.deleteOne({ _id: review._id }).exec();
    await this.recalculateHotelRating(review.hotel);

    if (user.role === Role.ADMIN && !review.user.equals(user.id)) {
      await this.audit.log(user, {
        action: 'review.delete',
        targetType: 'review',
        targetId: review._id,
        details: { hotel: review.hotel.toString(), rating: review.rating },
      });
    }
  }

  /**
   * HTL-24 (public): average rating, number of ratings and the visible reviews, newest first, paginated.
   * Hidden reviews (GEN-10) are skipped here; their authors still see them through GET /api/reviews/mine.
   */
  async listForHotel(hotelId: string, query: HotelReviewsQueryDto) {
    const hotel = await this.hotels.getById(hotelId);
    const filter = { hotel: hotel._id, isHidden: { $ne: true } };

    const [docs, total] = await Promise.all([
      this.reviewModel
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(query.skip)
        .limit(query.limit)
        .populate<{ user: PopulatedUser }>('user', 'firstName lastName')
        .exec(),
      this.reviewModel.countDocuments(filter).exec(),
    ]);

    const summary = await this.ratingSummary(hotel._id);
    return {
      hotelId: hotel._id.toString(),
      hotelName: hotel.name,
      averageRating: summary.reviewCount > 0 ? summary.averageRating : null,
      ratingCount: summary.reviewCount,
      reviews: paginate(
        docs.map((d) => this.toView(d)),
        total,
        query,
      ),
    };
  }

  /** The reviews I wrote, hidden ones included (marked isHidden), newest first */
  async listMine(user: AuthUser, query: HotelReviewsQueryDto) {
    const filter = { user: new Types.ObjectId(user.id) };
    const [docs, total] = await Promise.all([
      this.reviewModel
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(query.skip)
        .limit(query.limit)
        .populate<{ user: PopulatedUser }>('user', 'firstName lastName')
        .exec(),
      this.reviewModel.countDocuments(filter).exec(),
    ]);
    return paginate(
      docs.map((d) => this.toView(d, true)),
      total,
      query,
    );
  }

  /** One review. A hidden review is visible only to its author and admins (GEN-10). */
  async getOne(user: AuthUser | undefined, id: string) {
    const review = await this.populate(await this.getById(id));
    const isAuthor = !!user && review.user._id.equals(user.id);
    const isAdmin = user?.role === Role.ADMIN;
    if (review.isHidden && !isAuthor && !isAdmin) {
      throw new NotFoundException('Review not found');
    }
    return this.toView(review, isAuthor || isAdmin);
  }

  /**
   * Recomputes the hotel's averageRating and reviewCount from its visible reviews
   * and saves them on the hotel (Member 4's setRating).
   */
  async recalculateHotelRating(hotelId: Types.ObjectId | string) {
    const { averageRating, reviewCount } = await this.ratingSummary(hotelId);
    await this.hotels.setRating(hotelId, averageRating, reviewCount);
  }

  // ---------- helpers ----------

  private async ratingSummary(hotelId: Types.ObjectId | string) {
    const [row] = await this.reviewModel
      .aggregate<{ avg: number; count: number }>([
        {
          $match: {
            hotel: new Types.ObjectId(hotelId.toString()),
            isHidden: { $ne: true },
          },
        },
        { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
      ])
      .exec();
    return {
      averageRating: row ? Math.round(row.avg * 10) / 10 : 0,
      reviewCount: row?.count ?? 0,
    };
  }

  private async getById(id: string): Promise<ReviewDocument> {
    if (!Types.ObjectId.isValid(id))
      throw new NotFoundException('Review not found');
    const review = await this.reviewModel.findById(id).exec();
    if (!review) throw new NotFoundException('Review not found');
    return review;
  }

  private populate(review: ReviewDocument) {
    return review.populate<{ user: PopulatedUser }>(
      'user',
      'firstName lastName',
    );
  }

  private toView(
    r: Omit<ReviewDocument, 'user'> & { user: PopulatedUser | Types.ObjectId },
    showHiddenFlag = false,
  ) {
    const u = r.user as PopulatedUser;
    const name = [
      u?.firstName,
      u?.lastName?.charAt(0) ? `${u.lastName.charAt(0)}.` : '',
    ]
      .filter(Boolean)
      .join(' ');
    return {
      id: r._id.toString(),
      hotelId: r.hotel.toString(),
      bookingId: r.booking.toString(),
      rating: r.rating,
      comment: r.comment ?? null,
      author: { id: (u?._id ?? r.user).toString(), name: name || 'Guest' },
      createdAt: r.createdAt,
      editedAt: r.editedAt ?? null,
      ...(showHiddenFlag && { isHidden: !!r.isHidden }),
    };
  }
}
