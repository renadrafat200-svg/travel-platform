import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { Connection, Model, QueryFilter, Types } from 'mongoose';
import * as path from 'path';
import { AuditService } from '../audit/audit.service';
import { paginate } from '../common/dto/pagination-query.dto';
import { ProviderType, Role } from '../common/enums/role.enum';
import { AuthUser } from '../common/interfaces/auth-user.interface';
import { assertManagesProvider } from '../common/utils/ownership';
import { PLATFORM_CURRENCY } from '../config/platform.constants';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import {
  CreateHotelDto,
  HotelPoliciesDto,
  HotelQueryDto,
  UpdateHotelDto,
} from './dto/hotel.dto';
import {
  DEFAULT_CHECK_IN_TIME,
  DEFAULT_CHECK_OUT_TIME,
  DEFAULT_HOTEL_CANCELLATION,
  MAX_HOTEL_PHOTOS,
} from './hotel.constants';
import { Hotel, HotelDocument, HotelPolicies } from './schemas/hotel.schema';

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** What an uploaded file looks like (multer, memory storage) */
export interface UploadedImage {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** GEN-08 */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
/** Uploaded hotel photos are stored here (backend/uploads is in .gitignore) */
export const HOTEL_PHOTO_DIR = path.join(process.cwd(), 'uploads', 'hotels');

/** Detects the real file type from the first bytes, so a renamed .exe cannot pass as a .jpg */
function imageType(buf: Buffer): 'image/jpeg' | 'image/png' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return 'image/jpeg';
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length >= 8 && png.every((b, i) => buf[i] === b)) return 'image/png';
  return null;
}

@Injectable()
export class HotelsService {
  private readonly logger = new Logger(HotelsService.name);

  constructor(
    @InjectModel(Hotel.name) private readonly hotelModel: Model<Hotel>,
    @InjectConnection() private readonly connection: Connection,
    private readonly reference: ReferenceDataService,
    private readonly audit: AuditService,
  ) {}

  /** HTL-01: admin creates a hotel. Moderators are then assigned to it with POST /api/admin/moderators. */
  async create(admin: AuthUser, dto: CreateHotelDto) {
    const city = await this.reference.findCity(dto.city);
    if (!city)
      throw new BadRequestException(
        `Unknown city ${dto.city}. See GET /api/cities`,
      );

    const hotel = await this.hotelModel.create({
      ...dto,
      city: city._id,
      country: city.country,
      timeZone: await this.timeZoneOf(city._id),
      policies: this.normalisePolicies(
        dto.policies ?? {
          checkInTime: DEFAULT_CHECK_IN_TIME,
          checkOutTime: DEFAULT_CHECK_OUT_TIME,
          cancellationTiers: DEFAULT_HOTEL_CANCELLATION,
        },
      ),
    });
    await this.audit.log(admin, {
      action: 'hotel.create',
      targetType: 'hotel',
      targetId: hotel._id,
      details: { name: hotel.name, city: hotel.city },
    });
    return this.toView(hotel);
  }

  /** Public list. Guests only see active hotels; admins can ask for deactivated ones too. */
  async findAll(query: HotelQueryDto, user?: AuthUser) {
    const filter: QueryFilter<Hotel> = {};
    if (!(query.includeInactive && user?.role === Role.ADMIN))
      filter.isActive = true;
    if (query.city) filter.city = query.city;
    if (query.country) filter.country = query.country;
    if (query.search) {
      const re = new RegExp(escapeRegex(query.search), 'i');
      filter.$or = [{ name: re }, { address: re }];
    }
    const sortable = ['name', 'starRating', 'averageRating', 'createdAt'];
    const sortField =
      query.sortBy && sortable.includes(query.sortBy) ? query.sortBy : 'name';
    const [docs, total] = await Promise.all([
      this.hotelModel
        .find(filter)
        .sort({ [sortField]: query.order === 'desc' ? -1 : 1, _id: 1 })
        .skip(query.skip)
        .limit(query.limit)
        .exec(),
      this.hotelModel.countDocuments(filter).exec(),
    ]);
    return paginate(
      docs.map((d) => this.toView(d)),
      total,
      query,
    );
  }

  /** A hotel anyone may see: active, or the viewer manages it. 404 otherwise. */
  async getVisible(id: string, user?: AuthUser): Promise<HotelDocument> {
    const hotel = await this.getById(id);
    if (!hotel.isActive && !this.canManage(user, hotel._id)) {
      throw new NotFoundException('Hotel not found');
    }
    return hotel;
  }

  /** The hotel the logged-in hotel moderator manages */
  async findMine(user: AuthUser) {
    if (!user.providerId || user.providerType !== ProviderType.HOTEL) {
      throw new NotFoundException('No hotel is assigned to your account');
    }
    return this.toView(await this.getById(user.providerId));
  }

  /** HTL-02: this hotel's moderator (or an admin) edits the profile */
  async update(user: AuthUser, id: string, dto: UpdateHotelDto) {
    const hotel = await this.getManageable(user, id);
    const { policies, ...rest } = dto;
    hotel.set(rest);
    if (policies) hotel.policies = this.normalisePolicies(policies);
    await hotel.save();
    await this.audit.log(user, {
      action: 'hotel.update',
      targetType: 'hotel',
      targetId: hotel._id,
      details: { fields: Object.keys(dto) },
    });
    return this.toView(hotel);
  }

  /** HTL-09 / HTL-10. Existing reservations keep the tiers they were booked with. */
  async updatePolicies(user: AuthUser, id: string, dto: HotelPoliciesDto) {
    const hotel = await this.getManageable(user, id);
    hotel.policies = this.normalisePolicies(dto);
    await hotel.save();
    await this.audit.log(user, {
      action: 'hotel.policies.update',
      targetType: 'hotel',
      targetId: hotel._id,
    });
    return this.toView(hotel).policies;
  }

  // ---------- photos (GEN-08) ----------

  /** Upload JPG/PNG photos (max 5 MB each, max 5 per hotel). Served at GET /api/hotels/photos/:fileName. */
  async addPhotos(user: AuthUser, id: string, files: UploadedImage[]) {
    const hotel = await this.getManageable(user, id);
    if (!files?.length)
      throw new BadRequestException(
        'Attach at least one photo in the "photos" field',
      );
    if (hotel.photos.length + files.length > MAX_HOTEL_PHOTOS) {
      throw new BadRequestException(
        `A hotel can have at most ${MAX_HOTEL_PHOTOS} photos (it has ${hotel.photos.length})`,
      );
    }
    const checked = files.map((f) => {
      if (f.size > MAX_PHOTO_BYTES) {
        throw new BadRequestException(`${f.originalname} is larger than 5 MB`);
      }
      const type = imageType(f.buffer);
      if (!type)
        throw new BadRequestException(
          `${f.originalname} is not a JPG or PNG image`,
        );
      return { file: f, type };
    });

    await fs.mkdir(HOTEL_PHOTO_DIR, { recursive: true });
    for (const { file, type } of checked) {
      const fileName = `${hotel._id.toString()}-${randomUUID()}.${type === 'image/png' ? 'png' : 'jpg'}`;
      await fs.writeFile(path.join(HOTEL_PHOTO_DIR, fileName), file.buffer);
      hotel.photos.push({
        fileName,
        url: `/api/hotels/photos/${fileName}`,
        contentType: type,
        size: file.size,
      } as never);
    }
    await hotel.save();
    await this.audit.log(user, {
      action: 'hotel.photos.add',
      targetType: 'hotel',
      targetId: hotel._id,
      details: { count: checked.length },
    });
    return this.toView(hotel).photos;
  }

  async removePhoto(user: AuthUser, id: string, photoId: string) {
    const hotel = await this.getManageable(user, id);
    const photo = hotel.photos.find((p) => p._id.toString() === photoId);
    if (!photo) throw new NotFoundException('Photo not found');
    hotel.photos = hotel.photos.filter((p) => p._id.toString() !== photoId);
    await hotel.save();
    await fs
      .unlink(path.join(HOTEL_PHOTO_DIR, photo.fileName))
      .catch(() => undefined);
    await this.audit.log(user, {
      action: 'hotel.photos.remove',
      targetType: 'hotel',
      targetId: hotel._id,
    });
    return this.toView(hotel).photos;
  }

  /** Path of a stored photo, or 404. Only names this module created are accepted. */
  async photoFile(fileName: string) {
    if (!/^[a-f0-9]{24}-[a-f0-9-]{36}\.(jpg|png)$/.test(fileName)) {
      throw new NotFoundException('Photo not found');
    }
    const hotel = await this.hotelModel.exists({ 'photos.fileName': fileName });
    if (!hotel) throw new NotFoundException('Photo not found');
    return {
      path: path.join(HOTEL_PHOTO_DIR, fileName),
      contentType: fileName.endsWith('.png') ? 'image/png' : 'image/jpeg',
    };
  }

  /** HTL-02: newest visible reviews (Member 5 stores them in "reviews" with hotel + isHidden) */
  async latestReviews(hotelId: Types.ObjectId, limit = 5) {
    const docs = await this.connection
      .collection('reviews')
      .find({ hotel: hotelId, isHidden: { $ne: true } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
    return docs.map((r) => ({
      id: r._id.toString(),
      rating: r.rating,
      comment: r.comment ?? r.text ?? r.body,
      user: r.user?.toString(),
      createdAt: r.createdAt,
    }));
  }

  // ---------- helpers for teammates ----------

  /** Member 1: check the hotel exists before assigning a moderator to it */
  async exists(id: string): Promise<boolean> {
    return (
      Types.ObjectId.isValid(id) &&
      !!(await this.hotelModel.exists({ _id: id }))
    );
  }

  async isActive(id: string | Types.ObjectId): Promise<boolean> {
    return !!(await this.hotelModel.exists({ _id: id, isActive: true }));
  }

  /**
   * Member 1 (ACC-15): deactivate or reactivate a hotel. Deactivated hotels vanish from search
   * and cannot be booked; existing bookings stay valid. (The admin module writes the audit log.)
   */
  async setActive(id: string, active: boolean) {
    const hotel = await this.getById(id);
    hotel.isActive = active;
    hotel.deactivatedAt = active ? undefined : new Date();
    await hotel.save();
    return this.toView(hotel);
  }

  /** Member 5 (reviews): store the new average after a review is added, edited, deleted or hidden */
  async setRating(
    id: string | Types.ObjectId,
    averageRating: number,
    reviewCount: number,
  ) {
    await this.hotelModel
      .updateOne(
        { _id: id },
        {
          $set: {
            averageRating:
              reviewCount > 0 ? Math.round(averageRating * 10) / 10 : 0,
            reviewCount,
          },
        },
      )
      .exec();
  }

  /** Loads a hotel the user may manage (admin, or its own moderator). 404 / 403 otherwise. */
  async getManageable(user: AuthUser, id: string): Promise<HotelDocument> {
    const hotel = await this.getById(id);
    assertManagesProvider(user, ProviderType.HOTEL, hotel._id);
    return hotel;
  }

  async getById(id: string | Types.ObjectId): Promise<HotelDocument> {
    if (!Types.ObjectId.isValid(id.toString()))
      throw new BadRequestException('Invalid hotel id');
    const hotel = await this.hotelModel.findById(id).exec();
    if (!hotel) throw new NotFoundException('Hotel not found');
    return hotel;
  }

  canManage(user: AuthUser | undefined, hotelId: Types.ObjectId): boolean {
    if (!user) return false;
    if (user.role === Role.ADMIN) return true;
    return (
      user.role === Role.HOTEL_MODERATOR &&
      user.providerType === ProviderType.HOTEL &&
      user.providerId === hotelId.toString()
    );
  }

  /** Short public summary used in search results and bookings */
  summary(h: Hotel) {
    return {
      id: h._id.toString(),
      name: h.name,
      city: h.city,
      country: h.country,
      address: h.address,
      starRating: h.starRating,
      averageRating: h.reviewCount > 0 ? h.averageRating : null,
      reviewCount: h.reviewCount,
      amenities: h.amenities,
      photo: h.photos[0]?.url,
    };
  }

  toView(h: HotelDocument) {
    return {
      id: h._id.toString(),
      name: h.name,
      address: h.address,
      city: h.city,
      country: h.country,
      timeZone: h.timeZone,
      description: h.description,
      starRating: h.starRating,
      amenities: h.amenities,
      photos: h.photos.map((p) => ({ id: p._id.toString(), url: p.url })),
      currency: PLATFORM_CURRENCY,
      policies: {
        checkInTime: h.policies.checkInTime,
        checkOutTime: h.policies.checkOutTime,
        cancellationTiers: h.policies.cancellationTiers.map((t) => ({
          daysBeforeCheckIn: t.daysBeforeCheckIn,
          refundPercent: t.refundPercent,
        })),
        notes: h.policies.notes,
      },
      averageRating: h.reviewCount > 0 ? h.averageRating : null,
      reviewCount: h.reviewCount,
      isActive: h.isActive,
      createdAt: h.createdAt,
      updatedAt: h.updatedAt,
    };
  }

  // ---------- private ----------

  /** The city's time zone, from one of its airports in the official dataset */
  private async timeZoneOf(cityId: string): Promise<string> {
    const airports = await this.reference.listAirports({
      city: cityId,
    } as never);
    return airports[0]?.timeZone ?? 'UTC';
  }

  /** HTL-10: thresholds must be unique; stored sorted from highest to lowest */
  private normalisePolicies(p: HotelPoliciesDto): HotelPolicies {
    const tiers = [...p.cancellationTiers].sort(
      (a, b) => b.daysBeforeCheckIn - a.daysBeforeCheckIn,
    );
    for (let i = 1; i < tiers.length; i++) {
      if (tiers[i].daysBeforeCheckIn === tiers[i - 1].daysBeforeCheckIn) {
        throw new BadRequestException(
          `Two cancellation tiers have the same daysBeforeCheckIn (${tiers[i].daysBeforeCheckIn})`,
        );
      }
    }
    return {
      checkInTime: p.checkInTime,
      checkOutTime: p.checkOutTime,
      cancellationTiers: tiers.map((t) => ({
        daysBeforeCheckIn: t.daysBeforeCheckIn,
        refundPercent: t.refundPercent,
      })),
      notes: p.notes,
    };
  }
}
