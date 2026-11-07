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

  async exists(type: ReportTargetType, id: string | Types.ObjectId): Promise<boolean> {
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
    const res = await this.collection(type).updateOne(
      { _id: new Types.ObjectId(id.toString()) },
      { $set: { isHidden: true, hiddenAt: new Date() } },
    );
    if (res.matchedCount === 0) throw new NotFoundException(`That ${type} no longer exists`);
  }

  async remove(type: ReportTargetType, id: string | Types.ObjectId) {
    const res = await this.collection(type).deleteOne({ _id: new Types.ObjectId(id.toString()) });
    if (res.deletedCount === 0) throw new NotFoundException(`That ${type} no longer exists`);
  }
}