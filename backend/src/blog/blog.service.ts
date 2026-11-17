import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import { Connection, Model, PipelineStage, QueryFilter, Types } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import {
  paginate,
  PaginationQueryDto,
} from '../common/dto/pagination-query.dto';
import { AccountStatus, Role } from '../common/enums/role.enum';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import { UploadedImage, validateImages } from '../common/utils/image-upload';
import { User } from '../users/schemas/user.schema';
import { EXCERPT_LENGTH, MAX_POST_IMAGES, PostStatus } from './blog.constants';
import {
  CreateCommentDto,
  CreatePostDto,
  PostListQueryDto,
  UpdateCommentDto,
  UpdatePostDto,
} from './dto/blog.dto';
import { Comment, CommentDocument } from './schemas/comment.schema';
import { PostImageFile } from './schemas/post-image-file.schema';
import { PostLike } from './schemas/post-like.schema';
import { Post, PostDocument } from './schemas/post.schema';

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

type AuthorInfo = { id: string; name: string };

/**
 * Member 5: blog and community (BLG-01 to BLG-10, BLG-12).
 *
 * Visibility rules used everywhere:
 * - Published and not hidden: everyone (guests too).
 * - Draft or hidden: only the author and admins (hidden = GEN-10, set by Member 1's reports module).
 * - Liking and commenting: logged-in users, on published, not hidden posts only.
 */
@Injectable()
export class BlogService {
  constructor(
    @InjectModel(Post.name) private readonly postModel: Model<Post>,
    @InjectModel(Comment.name) private readonly commentModel: Model<Comment>,
    @InjectModel(PostLike.name) private readonly likeModel: Model<PostLike>,
    @InjectModel(PostImageFile.name)
    private readonly imageFileModel: Model<PostImageFile>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectConnection() private readonly connection: Connection,
    private readonly audit: AuditService,
  ) {}

  // =====================================================================================
  // Posts
  // =====================================================================================

  /** BLG-01: create a post as Draft (default) or Published */
  async createPost(user: AuthUser, dto: CreatePostDto) {
    const status = dto.status ?? PostStatus.DRAFT;
    const post = await this.postModel.create({
      author: new Types.ObjectId(user.id),
      title: dto.title,
      body: dto.body,
      tags: dto.tags ?? [],
      status,
      publishedAt: status === PostStatus.PUBLISHED ? new Date() : undefined,
    });
    return this.getPost(user, post._id.toString());
  }

  /** BLG-04 / BLG-08: the author edits title, body, tags or status */
  async updatePost(user: AuthUser, id: string, dto: UpdatePostDto) {
    const post = await this.getOwnPost(user, id);
    if (Object.values(dto).every((v) => v === undefined)) {
      throw new BadRequestException('Send at least one field to change');
    }
    if (dto.title !== undefined) post.title = dto.title;
    if (dto.body !== undefined) post.body = dto.body;
    if (dto.tags !== undefined) post.tags = dto.tags;
    if (dto.status !== undefined) {
      post.status = dto.status;
      // The date shown is the first publication date
      if (dto.status === PostStatus.PUBLISHED && !post.publishedAt)
        post.publishedAt = new Date();
    }
    await post.save();
    return this.getPost(user, id);
  }

  /** BLG-04: the author (or an admin) deletes a post with its comments, likes and images */
  async deletePost(user: AuthUser, id: string) {
    const post = await this.findPost(id);
    const isAuthor = post.author.equals(user.id);
    if (!isAuthor && user.role !== Role.ADMIN) {
      if (this.isPublic(post))
        throw new ForbiddenException('You can only delete your own posts');
      throw new NotFoundException('Post not found');
    }
    await Promise.all([
      this.commentModel.deleteMany({ post: post._id }).exec(),
      this.likeModel.deleteMany({ post: post._id }).exec(),
      this.imageFileModel.deleteMany({ post: post._id }).exec(),
    ]);
    await this.postModel.deleteOne({ _id: post._id }).exec();
    if (!isAuthor) {
      await this.audit.log(user, {
        action: 'post.delete',
        targetType: 'post',
        targetId: post._id,
        details: { title: post.title, author: post.author.toString() },
      });
    }
  }

  /**
   * BLG-02 + BLG-09: published posts, newest first, optionally filtered by tag.
   * With a keyword (q): matches title, tags or author name, ordered by likes + comments (newest on ties).
   */
  async listPublished(query: PostListQueryDto) {
    const filter: QueryFilter<Post> = {
      status: PostStatus.PUBLISHED,
      isHidden: { $ne: true },
    };
    if (query.tag) filter.tags = query.tag;

    if (query.q) {
      const rx = new RegExp(escapeRegex(query.q), 'i');
      const authorIds = await this.authorsMatching(query.q);
      filter.$or = [
        { title: rx },
        { tags: rx },
        { author: { $in: authorIds } },
      ];
    }

    const sort: Record<string, 1 | -1> = query.q
      ? { score: -1, publishedAt: -1, _id: -1 }
      : { publishedAt: -1, _id: -1 };
    return this.pagePosts(filter, sort, query);
  }

  /** BLG-08: GET /api/tags/:tag/posts */
  listByTag(tag: string, query: PaginationQueryDto) {
    const clean = tag.trim().replace(/^#+/, '').toLowerCase();
    return this.pagePosts(
      { status: PostStatus.PUBLISHED, isHidden: { $ne: true }, tags: clean },
      { publishedAt: -1, _id: -1 },
      query,
      { tag: clean },
    );
  }

  /** BLG-03: my posts including drafts (and hidden ones, marked), most recently changed first */
  async listMine(user: AuthUser, query: PaginationQueryDto) {
    const filter = { author: new Types.ObjectId(user.id) };
    const [docs, total] = await Promise.all([
      this.postModel
        .find(filter)
        .sort({ updatedAt: -1, _id: -1 })
        .skip(query.skip)
        .limit(query.limit)
        .exec(),
      this.postModel.countDocuments(filter).exec(),
    ]);
    const authors = await this.authorInfo(docs.map((d) => d.author));
    return paginate(
      docs.map((p) => ({
        ...this.toListItem(p, authors),
        status: p.status,
        isHidden: !!p.isHidden,
        updatedAt: p.updatedAt,
      })),
      total,
      query,
    );
  }

  /** BLG-02: the post page with author, date, body, tags, images, like count and comments (oldest first) */
  async getPost(user: AuthUser | undefined, id: string) {
    const post = await this.findVisiblePost(user, id);
    const isAuthor = !!user && post.author.equals(user.id);
    const isAdmin = user?.role === Role.ADMIN;

    // Hidden comments are shown only to their own author and to admins
    const commentFilter: QueryFilter<Comment> = { post: post._id };
    if (!isAdmin) {
      commentFilter.$or = [
        { isHidden: { $ne: true } },
        ...(user ? [{ author: new Types.ObjectId(user.id) }] : []),
      ];
    }
    const [comments, likedByMe] = await Promise.all([
      this.commentModel
        .find(commentFilter)
        .sort({ createdAt: 1, _id: 1 })
        .exec(),
      user
        ? this.likeModel
            .exists({ post: post._id, user: new Types.ObjectId(user.id) })
            .exec()
        : null,
    ]);
    const authors = await this.authorInfo([
      post.author,
      ...comments.map((c) => c.author),
    ]);

    return {
      id: post._id.toString(),
      title: post.title,
      body: post.body,
      author:
        authors.get(post.author.toString()) ?? this.unknownAuthor(post.author),
      date: post.publishedAt ?? post.createdAt,
      updatedAt: post.updatedAt,
      tags: post.tags,
      images: post.images.map((img) => ({
        id: img._id.toString(),
        url: img.url,
      })),
      likeCount: post.likeCount,
      commentCount: post.commentCount,
      likedByMe: !!likedByMe,
      ...((isAuthor || isAdmin) && {
        status: post.status,
        isHidden: !!post.isHidden,
      }),
      comments: comments.map((c) =>
        this.toCommentView(
          c,
          authors,
          isAdmin || (!!user && c.author.equals(user.id)),
        ),
      ),
    };
  }

  // =====================================================================================
  // Comments (BLG-05, BLG-07)
  // =====================================================================================

  async addComment(user: AuthUser, postId: string, dto: CreateCommentDto) {
    const post = await this.findInteractablePost(postId);
    const comment = await this.commentModel.create({
      post: post._id,
      author: new Types.ObjectId(user.id),
      body: dto.body,
    });
    await this.recountComments(post._id);
    const authors = await this.authorInfo([comment.author]);
    return this.toCommentView(comment, authors, true);
  }

  async updateComment(user: AuthUser, id: string, dto: UpdateCommentDto) {
    const comment = await this.findComment(id);
    if (!comment.author.equals(user.id)) {
      throw new ForbiddenException('You can only edit your own comments');
    }
    comment.body = dto.body;
    comment.editedAt = new Date();
    await comment.save();
    const authors = await this.authorInfo([comment.author]);
    return this.toCommentView(comment, authors, true);
  }

  /** The comment's author, or an admin (audited) */
  async deleteComment(user: AuthUser, id: string) {
    const comment = await this.findComment(id);
    const isAuthor = comment.author.equals(user.id);
    if (!isAuthor && user.role !== Role.ADMIN) {
      throw new ForbiddenException('You can only delete your own comments');
    }
    await this.commentModel.deleteOne({ _id: comment._id }).exec();
    await this.recountComments(comment.post);
    if (!isAuthor) {
      await this.audit.log(user, {
        action: 'comment.delete',
        targetType: 'comment',
        targetId: comment._id,
        details: { post: comment.post.toString() },
      });
    }
  }

  // =====================================================================================
  // Likes (BLG-06)
  // =====================================================================================

  async like(user: AuthUser, postId: string) {
    const post = await this.findInteractablePost(postId);
    try {
      await this.likeModel.create({
        post: post._id,
        user: new Types.ObjectId(user.id),
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        throw new ConflictException('You already liked this post');
      }
      throw err;
    }
    return { liked: true, likeCount: await this.recountLikes(post._id) };
  }

  async unlike(user: AuthUser, postId: string) {
    const post = await this.findPost(postId);
    const res = await this.likeModel
      .deleteOne({ post: post._id, user: new Types.ObjectId(user.id) })
      .exec();
    if (res.deletedCount === 0)
      throw new NotFoundException("You haven't liked this post");
    return { liked: false, likeCount: await this.recountLikes(post._id) };
  }

  // =====================================================================================
  // Images (BLG-10, GEN-08)
  // =====================================================================================

  async addImages(user: AuthUser, postId: string, files: UploadedImage[]) {
    const post = await this.getOwnPost(user, postId);
    const checked = validateImages(files, post.images.length, MAX_POST_IMAGES);

    const newFiles = checked.map(({ file, type, extension }) => ({
      fileName: `${post._id.toString()}-${randomUUID()}.${extension}`,
      post: post._id,
      contentType: type,
      size: file.size,
      data: file.buffer,
    }));
    await this.imageFileModel.insertMany(newFiles);

    // Atomic: only adds the images if the post still has room (two uploads at once can't pass 5)
    const updated = await this.postModel
      .findOneAndUpdate(
        {
          _id: post._id,
          [`images.${MAX_POST_IMAGES - newFiles.length}`]: { $exists: false },
        },
        {
          $push: {
            images: {
              $each: newFiles.map((f) => ({
                fileName: f.fileName,
                url: `/api/posts/images/${f.fileName}`,
                contentType: f.contentType,
                size: f.size,
              })),
            },
          },
        },
        { returnDocument: 'after' },
      )
      .exec();
    if (!updated) {
      await this.imageFileModel
        .deleteMany({ fileName: { $in: newFiles.map((f) => f.fileName) } })
        .exec();
      throw new BadRequestException(
        `A post can have at most ${MAX_POST_IMAGES} images`,
      );
    }
    return updated.images.map((img) => ({
      id: img._id.toString(),
      url: img.url,
    }));
  }

  async removeImage(user: AuthUser, postId: string, imageId: string) {
    const post = await this.getOwnPost(user, postId);
    const image = post.images.find((img) => img._id.toString() === imageId);
    if (!image) throw new NotFoundException('Image not found on this post');
    await this.postModel
      .updateOne({ _id: post._id }, { $pull: { images: { _id: image._id } } })
      .exec();
    await this.imageFileModel.deleteOne({ fileName: image.fileName }).exec();
    const after = await this.findPost(postId);
    return after.images.map((img) => ({
      id: img._id.toString(),
      url: img.url,
    }));
  }

  /** GET /api/posts/images/:fileName: the image bytes */
  async imageFile(fileName: string) {
    if (!/^[a-f0-9]{24}-[a-f0-9-]{36}\.(jpg|png)$/.test(fileName)) {
      throw new NotFoundException('Image not found');
    }
    const file = await this.imageFileModel.findOne({ fileName }).exec();
    if (!file) throw new NotFoundException('Image not found');
    return { data: file.data, contentType: file.contentType };
  }

  // =====================================================================================
  // Author page (BLG-12)
  // =====================================================================================

  async authorPage(authorId: string, query: PaginationQueryDto) {
    if (!Types.ObjectId.isValid(authorId))
      throw new NotFoundException('Author not found');
    const user = await this.userModel
      .findById(authorId)
      .select('firstName lastName createdAt status')
      .lean()
      .exec();
    if (!user || user.status === AccountStatus.DEACTIVATED)
      throw new NotFoundException('Author not found');

    const posts = await this.pagePosts(
      {
        author: user._id,
        status: PostStatus.PUBLISHED,
        isHidden: { $ne: true },
      },
      { publishedAt: -1, _id: -1 },
      query,
    );
    return {
      id: user._id.toString(),
      name: `${user.firstName} ${user.lastName}`.trim(),
      joinedAt: user.createdAt,
      posts,
      publicItineraries: await this.publicItineraries(user._id),
    };
  }

  // =====================================================================================
  // Helpers
  // =====================================================================================

  /** Published, not hidden */
  private isPublic(post: Post) {
    return post.status === PostStatus.PUBLISHED && !post.isHidden;
  }

  private async findPost(id: string): Promise<PostDocument> {
    if (!Types.ObjectId.isValid(id))
      throw new NotFoundException('Post not found');
    const post = await this.postModel.findById(id).exec();
    if (!post) throw new NotFoundException('Post not found');
    return post;
  }

  /** Drafts and hidden posts look like "not found" to everyone except the author and admins */
  private async findVisiblePost(user: AuthUser | undefined, id: string) {
    const post = await this.findPost(id);
    const allowed =
      this.isPublic(post) ||
      (!!user && (post.author.equals(user.id) || user.role === Role.ADMIN));
    if (!allowed) throw new NotFoundException('Post not found');
    return post;
  }

  private async getOwnPost(user: AuthUser, id: string) {
    const post = await this.findPost(id);
    if (!post.author.equals(user.id)) {
      if (this.isPublic(post))
        throw new ForbiddenException('You can only change your own posts');
      throw new NotFoundException('Post not found');
    }
    return post;
  }

  /** Liking and commenting are only possible on published, not hidden posts */
  private async findInteractablePost(id: string) {
    const post = await this.findPost(id);
    if (!this.isPublic(post)) throw new NotFoundException('Post not found');
    return post;
  }

  private async findComment(id: string): Promise<CommentDocument> {
    if (!Types.ObjectId.isValid(id))
      throw new NotFoundException('Comment not found');
    const comment = await this.commentModel.findById(id).exec();
    if (!comment) throw new NotFoundException('Comment not found');
    return comment;
  }

  private async recountComments(postId: Types.ObjectId) {
    const count = await this.commentModel
      .countDocuments({ post: postId, isHidden: { $ne: true } })
      .exec();
    await this.postModel
      .updateOne({ _id: postId }, { $set: { commentCount: count } })
      .exec();
    return count;
  }

  private async recountLikes(postId: Types.ObjectId) {
    const count = await this.likeModel.countDocuments({ post: postId }).exec();
    await this.postModel
      .updateOne({ _id: postId }, { $set: { likeCount: count } })
      .exec();
    return count;
  }

  /** Ids of users whose first name, last name or full name contains the keyword */
  private async authorsMatching(q: string): Promise<Types.ObjectId[]> {
    const rx = escapeRegex(q);
    const users = await this.userModel
      .find({
        $or: [
          { firstName: { $regex: rx, $options: 'i' } },
          { lastName: { $regex: rx, $options: 'i' } },
          {
            $expr: {
              $regexMatch: {
                input: { $concat: ['$firstName', ' ', '$lastName'] },
                regex: rx,
                options: 'i',
              },
            },
          },
        ],
      })
      .select('_id')
      .limit(500)
      .lean()
      .exec();
    return users.map((u) => u._id);
  }

  /** One page of posts as list items, ordered by `sort` (score = likes + comments) */
  private async pagePosts(
    filter: QueryFilter<Post>,
    sort: Record<string, 1 | -1>,
    query: PaginationQueryDto,
    extra: Record<string, unknown> = {},
  ) {
    const pipeline: PipelineStage[] = [
      { $match: filter as PipelineStage.Match['$match'] },
      { $addFields: { score: { $add: ['$likeCount', '$commentCount'] } } },
      { $sort: sort },
      {
        $facet: {
          items: [{ $skip: query.skip }, { $limit: query.limit }],
          total: [{ $count: 'n' }],
        },
      },
    ];
    const [res] = await this.postModel
      .aggregate<{ items: Post[]; total: { n: number }[] }>(pipeline)
      .exec();
    const items = res?.items ?? [];
    const authors = await this.authorInfo(items.map((p) => p.author));
    const page = paginate(
      items.map((p) => this.toListItem(p, authors)),
      res?.total[0]?.n ?? 0,
      query,
    );
    // BLG-09: the frontend shows "No results" when items is empty
    return { ...extra, ...page };
  }

  private async authorInfo(
    ids: Types.ObjectId[],
  ): Promise<Map<string, AuthorInfo>> {
    const unique = [...new Set(ids.map((i) => i.toString()))];
    if (unique.length === 0) return new Map();
    const users = await this.userModel
      .find({ _id: { $in: unique } })
      .select('firstName lastName')
      .lean()
      .exec();
    return new Map(
      users.map((u) => [
        u._id.toString(),
        { id: u._id.toString(), name: `${u.firstName} ${u.lastName}`.trim() },
      ]),
    );
  }

  private unknownAuthor(id: Types.ObjectId): AuthorInfo {
    return { id: id.toString(), name: 'Deleted user' };
  }

  private toListItem(p: Post, authors: Map<string, AuthorInfo>) {
    const body = p.body ?? '';
    return {
      id: p._id.toString(),
      title: p.title,
      excerpt:
        body.length > EXCERPT_LENGTH
          ? `${body.slice(0, EXCERPT_LENGTH).trimEnd()}…`
          : body,
      author: authors.get(p.author.toString()) ?? this.unknownAuthor(p.author),
      date: p.publishedAt ?? p.createdAt,
      tags: p.tags,
      coverImage: p.images?.[0]?.url ?? null,
      likeCount: p.likeCount,
      commentCount: p.commentCount,
    };
  }

  private toCommentView(
    c: Comment,
    authors: Map<string, AuthorInfo>,
    showHiddenFlag: boolean,
  ) {
    return {
      id: c._id.toString(),
      postId: c.post.toString(),
      body: c.body,
      author: authors.get(c.author.toString()) ?? this.unknownAuthor(c.author),
      createdAt: c.createdAt,
      editedAt: c.editedAt ?? null,
      ...(showHiddenFlag && { isHidden: !!c.isHidden }),
    };
  }

  /**
   * BLG-12: public itineraries of this author. Member 7 owns itineraries; until that module is
   * merged this reads the shared "itineraries" collection directly and returns [] when it's empty.
   * Accepts the common field names (owner/user/author, isPublic or visibility "public").
   */
  private async publicItineraries(authorId: Types.ObjectId) {
    const docs = await this.connection
      .collection('itineraries')
      .find({
        $and: [
          {
            $or: [
              { owner: authorId },
              { user: authorId },
              { author: authorId },
            ],
          },
          { $or: [{ isPublic: true }, { visibility: 'public' }] },
          { isHidden: { $ne: true } },
        ],
      })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();
    return docs.map((d) => ({
      id: d._id.toString(),
      title: d.title as string,
      countries: (d.countries as unknown[]) ?? [],
      startDate: d.startDate as Date | undefined,
    }));
  }
}
