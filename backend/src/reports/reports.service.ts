import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter, Types } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import { paginate } from '../common/dto/pagination-query.dto';
import { AuthUser } from '../common/interfaces/auth-user.interface';
import { ContentModerationService } from './content-moderation.service';
import { CreateReportDto, ReportAction, ReportQueryDto, ResolveReportDto } from './dto/report.dto';
import { ReportTargetType } from './reportable-content';
import { Report, ReportStatus } from './schemas/report.schema';

const OUTCOME: Record<ReportAction, ReportStatus> = {
  [ReportAction.DISMISS]: ReportStatus.DISMISSED,
  [ReportAction.HIDE]: ReportStatus.CONTENT_HIDDEN,
  [ReportAction.DELETE]: ReportStatus.CONTENT_DELETED,
};

@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Report.name) private readonly reportModel: Model<Report>,
    private readonly content: ContentModerationService,
    private readonly audit: AuditService,
  ) {}

  /** A logged-in user reports a post, comment, review or itinerary */
  async create(user: AuthUser, dto: CreateReportDto) {
    await this.content.assertExists(dto.targetType, dto.targetId);

    const alreadyReported = await this.reportModel.exists({
      reporter: new Types.ObjectId(user.id),
      targetType: dto.targetType,
      targetId: new Types.ObjectId(dto.targetId),
      status: ReportStatus.OPEN,
    });
    if (alreadyReported) {
      throw new ConflictException('You have already reported this and it is still being reviewed');
    }

    const report = await this.reportModel.create({
      reporter: new Types.ObjectId(user.id),
      targetType: dto.targetType,
      targetId: new Types.ObjectId(dto.targetId),
      reason: dto.reason,
      details: dto.details,
    });
    return { message: 'Thank you, an administrator will review this report', id: report._id.toString() };
  }

  /** GEN-09: admin list, newest first, open ones easy to filter */
  async findAll(query: ReportQueryDto) {
    const filter: QueryFilter<Report> = {};
    if (query.status) filter.status = query.status;
    if (query.targetType) filter.targetType = query.targetType;

    const [items, total] = await Promise.all([
      this.reportModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(query.skip)
        .limit(query.limit)
        .populate('reporter', 'email firstName lastName')
        .lean()
        .exec(),
      this.reportModel.countDocuments(filter).exec(),
    ]);
    return paginate(items, total, query);
  }

  /**
   * GEN-10: admin decides. Hiding or deleting also closes every other open report
   * about the same content, so admins do not handle the same thing twice.
   */
  async resolve(admin: AuthUser, id: string, dto: ResolveReportDto) {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid report id');
    const report = await this.reportModel.findById(id).exec();
    if (!report) throw new NotFoundException('Report not found');
    if (report.status !== ReportStatus.OPEN) {
      throw new BadRequestException(`This report was already handled (${report.status})`);
    }

    if (dto.action === ReportAction.HIDE) {
      await this.content.hide(report.targetType, report.targetId);
    } else if (dto.action === ReportAction.DELETE) {
      await this.content.remove(report.targetType, report.targetId);
    }

    const status = OUTCOME[dto.action];
    const closeFilter =
      dto.action === ReportAction.DISMISS
        ? { _id: report._id }
        : { targetType: report.targetType, targetId: report.targetId, status: ReportStatus.OPEN };
    const closed = await this.closeReports(admin, closeFilter, status, dto.note);

    await this.audit.log(admin, {
      action: `report.${dto.action}`,
      targetType: report.targetType,
      targetId: report.targetId,
      details: { reportId: report._id.toString(), reason: report.reason, note: dto.note, reportsClosed: closed },
    });
    // TODO: when Notifications (Member 6) is merged, notify the reporter (and the author if hidden/deleted).
    return { message: `Report ${status.replace('_', ' ')}`, id: report._id.toString(), status, reportsClosed: closed };
  }

  /** GEN-10: DELETE /api/admin/content/:type/:id — remove content directly, even without a report */
  async deleteContent(admin: AuthUser, type: ReportTargetType, id: string) {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid content id');
    await this.content.remove(type, id);
    const closed = await this.closeReports(
      admin,
      { targetType: type, targetId: new Types.ObjectId(id), status: ReportStatus.OPEN },
      ReportStatus.CONTENT_DELETED,
      'Content deleted by administrator',
    );
    await this.audit.log(admin, {
      action: 'content.delete',
      targetType: type,
      targetId: id,
      details: { reportsClosed: closed },
    });
  }

  private async closeReports(
    admin: AuthUser,
    filter: QueryFilter<Report>,
    status: ReportStatus,
    note?: string,
  ): Promise<number> {
    const res = await this.reportModel
      .updateMany(filter, {
        $set: {
          status,
          resolvedBy: new Types.ObjectId(admin.id),
          resolvedAt: new Date(),
          resolutionNote: note,
        },
      })
      .exec();
    return res.modifiedCount;
  }
}
