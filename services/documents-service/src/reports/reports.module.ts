import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditReporter } from '../common/audit/audit-reporter.service';
import { SessionGuard } from '../common/auth/session.guard';
import { NotificationsReporter } from '../common/notifications/notifications-reporter.service';
import { ALMACEN_OBJETOS } from './archivos/almacen/almacen';
import { crearAlmacen } from './archivos/almacen/crear-almacen';
import { Archivo, ArchivoSchema } from './archivos/archivo.schema';
import { ArchivosController, DescargaLocalController } from './archivos/archivos.controller';
import { ArchivosService } from './archivos/archivos.service';
import { ExcelService } from './excel.service';
import { IndicatorsService } from './indicators.service';
import { PdfService } from './pdf.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { Reporte, ReporteSchema } from './schemas/report.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Reporte.name, schema: ReporteSchema },
      { name: Archivo.name, schema: ArchivoSchema },
    ]),
    JwtModule.register({}),
  ],
  controllers: [ReportsController, ArchivosController, DescargaLocalController],
  providers: [
    ReportsService,
    IndicatorsService,
    PdfService,
    ExcelService,
    AuditReporter,
    NotificationsReporter,
    SessionGuard,
    ArchivosService,
    // `local` (doble en disco) o `gcs` según ARCHIVOS_ALMACEN; ver crear-almacen.ts.
    { provide: ALMACEN_OBJETOS, useFactory: () => crearAlmacen() },
  ],
  // El health reporta el estado del almacén.
  exports: [ALMACEN_OBJETOS],
})
export class ReportsModule {}
