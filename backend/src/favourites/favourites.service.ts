import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, QueryFilter, Types } from 'mongoose';
import { paginate } from '../common/dto/pagination-query.dto';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import { AddFavouriteDto, FavouritesQueryDto } from './dto/favourite.dto';
import { Favourite, FavouriteType } from './schemas/favourite.schema';

/** At most this many favourites per user */
const MAX_FAVOURITES = 500;

type Row = Record<string, unknown>;

/** Where each kind lives, what makes it visible to others, and how to show it */
const KINDS: Record<
  FavouriteType,
  { collection: string; visible: Row; view: (d: Row) => Row; link: (id: string) => string }
> = {
  [FavouriteType.HOTEL]: {
    collection: 'hotels',
    visible: { isActive: { $ne: false } },
    view: (d) => ({ title: d.name, city: d.city, starRating: d.starRating, averageRating: d.averageRating ?? null }),
    link: (id) => `/api/hotels/${id}`,
  },
  [FavouriteType.ITINERARY]: {
    collection: 'itineraries',
    visible: { isPublic: true, isHidden: { $ne: true } },
    view: (d) => ({ title: d.title, countries: d.countries, days: d.dayCount }),
    link: (id) => `/api/itineraries/public/${id}`,
  },
  [FavouriteType.POST]: {
    collection: 'posts',
    visible: { status: 'published', isHidden: { $ne: true } },
    view: (d) => ({ title: d.title, tags: d.tags, likeCount: d.likeCount }),
    link: (id) => `/api/posts/${id}`,
  },
};

/**
 * Optional bonus: favourites. A logged-in user saves hotels, public itineraries and
 * published blog posts. Things that are later deactivated, made private, hidden or deleted
 * stay in the list marked available: false, so the user understands why they cannot open them.
 */
@Injectable()
export class FavouritesService {
  constructor(
    @InjectModel(Favourite.name) private readonly favouriteModel: Model<Favourite>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async add(user: AuthUser, dto: AddFavouriteDto) {
    const kind = KINDS[dto.type];
    const target = new Types.ObjectId(dto.id);
    const exists = await this.connection
      .collection(kind.collection)
      .countDocuments({ _id: target, ...kind.visible }, { limit: 1 });
    if (!exists) throw new NotFoundException(`No available ${dto.type} with this id`);
    const mine = { user: new Types.ObjectId(user.id) };
    if ((await this.favouriteModel.countDocuments(mine).exec()) >= MAX_FAVOURITES) {
      throw new BadRequestException(`You can save at most ${MAX_FAVOURITES} favourites`);
    }
    try {
      const fav = await this.favouriteModel.create({ ...mine, type: dto.type, target });
      return (await this.views([fav.toObject()]))[0];
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        throw new ConflictException(`This ${dto.type} is already in your favourites`);
      }
      throw err;
    }
  }

  async list(user: AuthUser, query: FavouritesQueryDto) {
    const filter: QueryFilter<Favourite> = { user: new Types.ObjectId(user.id) };
    if (query.type) filter.type = query.type;
    const [docs, total] = await Promise.all([
      this.favouriteModel.find(filter).sort({ createdAt: -1, _id: -1 }).skip(query.skip).limit(query.limit).lean().exec(),
      this.favouriteModel.countDocuments(filter).exec(),
    ]);
    return paginate(await this.views(docs), total, query);
  }

  /** "Is this in my favourites?" for one thing (handy for a heart icon) */
  async check(user: AuthUser, type: FavouriteType, id: string) {
    if (!Object.values(FavouriteType).includes(type)) throw new BadRequestException('Unknown favourite type');
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid id');
    const fav = await this.favouriteModel
      .exists({ user: new Types.ObjectId(user.id), type, target: new Types.ObjectId(id) })
      .exec();
    return { type, id, isFavourite: !!fav };
  }

  async remove(user: AuthUser, type: FavouriteType, id: string) {
    if (!Object.values(FavouriteType).includes(type)) throw new BadRequestException('Unknown favourite type');
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Not in your favourites');
    const res = await this.favouriteModel
      .deleteOne({ user: new Types.ObjectId(user.id), type, target: new Types.ObjectId(id) })
      .exec();
    if (!res.deletedCount) throw new NotFoundException('Not in your favourites');
  }

  /** Adds the title etc. of each saved thing, and whether it can still be opened */
  private async views(favs: Favourite[]) {
    const byType = new Map<FavouriteType, Map<string, Row>>();
    for (const type of Object.values(FavouriteType)) {
      const ids = favs.filter((f) => f.type === type).map((f) => f.target);
      if (!ids.length) continue;
      const kind = KINDS[type];
      const docs = await this.connection.collection(kind.collection).find({ _id: { $in: ids } }).toArray();
      byType.set(type, new Map(docs.map((d) => [d._id.toString(), d as Row])));
    }
    return favs.map((f) => {
      const kind = KINDS[f.type];
      const doc = byType.get(f.type)?.get(f.target.toString());
      const available = !!doc && this.matches(doc, kind.visible);
      const id = f.target.toString();
      return {
        type: f.type,
        id,
        savedAt: f.createdAt,
        available,
        ...(doc ? kind.view(doc) : { title: null }),
        url: kind.link(id),
      };
    });
  }

  /** The same visibility rules as the database filters above, checked on a loaded document */
  private matches(doc: Row, rule: Row): boolean {
    return Object.entries(rule).every(([key, cond]) => {
      const value = doc[key];
      if (cond && typeof cond === 'object' && '$ne' in (cond as Row)) return value !== (cond as Row).$ne;
      return value === cond;
    });
  }
}
