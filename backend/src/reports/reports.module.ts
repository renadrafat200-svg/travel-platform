import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ContentModerationService } from './content-moderation.service';
import { AdminReportsController, ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { Report, ReportSchema } from './schemas/report.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: Report.name, schema: ReportSchema }])],
  controllers: [ReportsController, AdminReportsController],
  providers: [ReportsService, ContentModerationService],
  exports: [ContentModerationService],
})
export class ReportsModule {}