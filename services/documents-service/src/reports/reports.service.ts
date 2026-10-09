import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, isValidObjectId, Model } from 'mongoose';
import { AuditReporter } from '../common/audit/audit-reporter.service';
import { SesionUsuario } from '../common/auth/session.guard';
import { LIMITE_DEFAULT, LIMITE_MAXIMO, PAGINA_DEFAULT, Pagina } from '../common/dto/pagination.dto';
import { ROL } from '../common/roles';
import { ActualizarReporteDto, GenerarReporteEjecutivoDto, ListarReportesDto } from './dto/reports.dto';
import { ExcelService } from './excel.service';
import { IndicatorsService } from './indicators.service';
import { PdfService } from './pdf.service';
import { ESTADO_REPORTE, Indicador, ParametrosReporte, Reporte, ReporteDocument } from './schemas/report.schema';

export const TIPO_EJECUTIVO = 'ejecutivo';

/** Forma pública de un reporte (JSON y XML). */
export interface ReporteDto {
  id: string;
  tipo: string;
  parametros: ParametrosReporte;
  formato: string;
  usuarioId: string;
  estado: string;
  creadoEn: Date;
  secciones: Indicador[];
}

export interface EstadisticaMensual {
  usuarioId: string;
  mes: string;
  reportes: number;
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    @InjectModel(Reporte.name) private readonly modelo: Model<ReporteDocument>,
    @InjectConnection() private readonly conexion: Connection,
    private readonly indicadores: IndicatorsService,
    private readonly pdf: PdfService,
    private readonly excel: ExcelService,
    private readonly audit: AuditReporter,
  ) {}

  /** Con Mongo caído se responde 503 al instante en vez de dejar la petición colgada. */
  private exigirMongo() {
    if (this.conexion.readyState !== 1) {
      throw new ServiceUnavailableException('El historial de reportes (MongoDB) no está disponible. Intenta más tarde.');
    }
  }

  async generarEjecutivo(
    dto: GenerarReporteEjecutivoDto,
    usuario: SesionUsuario,
    authorization: string | undefined,
    ip?: string,
  ): Promise<ReporteDto> {
    this.exigirMongo();
    const parametros: ParametrosReporte = {
      dateFrom: dto.dateFrom,
      dateTo: dto.dateTo,
      zoneId: dto.zoneId ?? null,
      segmentId: dto.segmentId ?? null,
    };
    const secciones = await this.indicadores.reunir(parametros, authorization);

    const creado = await this.modelo.create({
      tipo: TIPO_EJECUTIVO,
      parametros,
      formato: 'json',
      usuarioId: usuario.id,
      estado: ESTADO_REPORTE.GENERADO,
      creadoEn: new Date(),
      secciones,
    });

    const sinDatos = secciones.filter((s) => !s.disponible).length;
    await this.audit.reportar(
      {
        tabla: 'reportes',
        registroId: String(creado._id),
        accion: 'insert',
        descripcion: `Reporte ejecutivo generado (${dto.dateFrom} a ${dto.dateTo}); ${sinDatos} indicador(es) no disponible(s).`,
        ip: ip ?? null,
      },
      authorization,
    );
    return this.aDto(creado);
  }

  async listar(filtros: ListarReportesDto, usuario: SesionUsuario): Promise<Pagina<ReporteDto>> {
    this.exigirMongo();
    const page = filtros.page ?? PAGINA_DEFAULT;
    const limit = Math.min(filtros.limit ?? LIMITE_DEFAULT, LIMITE_MAXIMO);

    const criterio: Record<string, unknown> = {};
    // DOC-04: un Proveedor solo ve lo suyo; no puede pedir los de otro con ?usuarioId=.
    if (usuario.rol === ROL.PROVEEDOR) criterio.usuarioId = usuario.id;
    else if (filtros.usuarioId) criterio.usuarioId = filtros.usuarioId;
    if (filtros.tipo) criterio.tipo = filtros.tipo;
    if (filtros.dateFrom || filtros.dateTo) {
      criterio.creadoEn = {
        ...(filtros.dateFrom ? { $gte: new Date(`${filtros.dateFrom}T00:00:00.000Z`) } : {}),
        ...(filtros.dateTo ? { $lte: new Date(`${filtros.dateTo}T23:59:59.999Z`) } : {}),
      };
    }

    const [docs, total] = await Promise.all([
      this.modelo.find(criterio).sort({ creadoEn: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(false),
      this.modelo.countDocuments(criterio),
    ]);
    return { data: docs.map((d) => this.aDto(d)), total, page, limit };
  }

  async obtener(id: string, usuario: SesionUsuario): Promise<ReporteDto> {
    return this.aDto(await this.buscar(id, usuario));
  }

  async actualizarEstado(id: string, dto: ActualizarReporteDto, usuario: SesionUsuario): Promise<ReporteDto> {
    const doc = await this.buscar(id, usuario);
    doc.estado = dto.estado as ReporteDocument['estado'];
    await doc.save();
    return this.aDto(doc);
  }

  /** Agregación: reportes por usuario y mes (índice `usuarioId + creadoEn`). */
  async estadisticasPorUsuarioMes(usuario: SesionUsuario): Promise<EstadisticaMensual[]> {
    this.exigirMongo();
    const filas = await this.modelo.aggregate<{ _id: { usuarioId: string; mes: string }; reportes: number }>([
      ...(usuario.rol === ROL.PROVEEDOR ? [{ $match: { usuarioId: usuario.id } }] : []),
      {
        $group: {
          _id: { usuarioId: '$usuarioId', mes: { $dateToString: { format: '%Y-%m', date: '$creadoEn' } } },
          reportes: { $sum: 1 },
        },
      },
      { $sort: { '_id.mes': -1, '_id.usuarioId': 1 } },
    ]);
    return filas.map((f) => ({ usuarioId: f._id.usuarioId, mes: f._id.mes, reportes: f.reportes }));
  }

  /**
   * PDF o Excel a partir del documento guardado (idéntico al JSON). Marca el reporte como exportado.
   * El PDF es obligatorio (D-19); el Excel es opcional y lleva las cifras como celdas numéricas.
   */
  async exportar(id: string, formato: 'pdf' | 'xlsx', usuario: SesionUsuario, authorization: string | undefined, ip?: string) {
    const doc = await this.buscar(id, usuario);
    const dto = this.aDto(doc);
    const buffer = formato === 'xlsx' ? await this.excel.generar(dto) : await this.pdf.generar(dto);

    if (doc.estado !== ESTADO_REPORTE.EXPORTADO) {
      doc.estado = ESTADO_REPORTE.EXPORTADO;
      await doc.save();
    }
    await this.audit.reportar(
      { tabla: 'reportes', registroId: dto.id, accion: 'exportar', descripcion: `Reporte ejecutivo exportado a ${formato === 'xlsx' ? 'Excel' : 'PDF'}.`, ip: ip ?? null },
      authorization,
    );
    const fecha = dto.creadoEn.toISOString().slice(0, 10);
    return { buffer, nombre: `reporte-ejecutivo-${fecha}.${formato}`, formato };
  }

  /**
   * Un id mal formado es 400. Un reporte inexistente o AJENO (para un Proveedor)
   * es 404, no 403: no se confirma que exista (DOC-04).
   */
  private async buscar(id: string, usuario: SesionUsuario): Promise<ReporteDocument> {
    this.exigirMongo();
    if (!isValidObjectId(id)) throw new BadRequestException('El id del reporte no es válido.');
    const doc = await this.modelo.findById(id);
    if (!doc || (usuario.rol === ROL.PROVEEDOR && doc.usuarioId !== usuario.id)) {
      throw new NotFoundException('El reporte no existe.');
    }
    return doc;
  }

  private aDto(d: ReporteDocument): ReporteDto {
    return {
      id: String(d._id),
      tipo: d.tipo,
      parametros: d.parametros,
      formato: d.formato,
      usuarioId: d.usuarioId,
      estado: d.estado,
      creadoEn: d.creadoEn,
      secciones: d.secciones,
    };
  }
}
