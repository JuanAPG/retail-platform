import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditReporter } from '../common/audit/audit-reporter.service';
import { SessionGuard } from '../common/auth/session.guard';
import { ExcelService } from './excel.service';
import { IndicatorsService } from './indicators.service';
import { PdfService } from './pdf.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { Reporte, ReporteSchema } from './schemas/report.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: Reporte.name, schema: ReporteSchema }]), JwtModule.register({})],
  controllers: [ReportsController],
  providers: [ReportsService, IndicatorsService, PdfService, ExcelService, AuditReporter, SessionGuard],
})
export class ReportsModule {}
