import {
  BadRequestException,
  ConflictException,
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
import { GENERAN_REPORTES, ROL } from '../common/roles';
import { generarCsv } from './csv';
import { ActualizarReporteDto, FormatoExportacion, GenerarReporteEjecutivoDto, ListarReportesDto } from './dto/reports.dto';
import { ExcelService } from './excel.service';
import { IndicatorsService } from './indicators.service';
import { PdfService } from './pdf.service';
import { ESTADO_REPORTE, Indicador, ParametrosReporte, Reporte, ReporteDocument } from './schemas/report.schema';

export const TIPO_EJECUTIVO = 'ejecutivo';

const NOMBRE_FORMATO: Record<FormatoExportacion, string> = { pdf: 'PDF', xlsx: 'Excel', csv: 'CSV' };

/** Content-Type de cada formato de exportación. */
export const TIPO_CONTENIDO: Record<FormatoExportacion, string> = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
};

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

/** Nombre que ve quien descarga. El objeto en el almacén tiene otra ruta, generada por el servicio. */
export function nombreDescarga(dto: Pick<ReporteDto, 'creadoEn'>, formato: FormatoExportacion): string {
  return `reporte-ejecutivo-${dto.creadoEn.toISOString().slice(0, 10)}.${formato}`;
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
    // QA-DOC54-03: la exportación ya quedó en auditoría; regresar a "generado" la contradeciría.
    if (doc.estado === ESTADO_REPORTE.EXPORTADO && dto.estado === ESTADO_REPORTE.GENERADO) {
      throw new ConflictException('Un reporte exportado no puede volver a "generado": la exportación ya quedó registrada en la auditoría.');
    }
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
  async exportar(id: string, formato: FormatoExportacion, usuario: SesionUsuario, authorization: string | undefined, ip?: string) {
    const doc = await this.buscar(id, usuario);
    const dto = this.aDto(doc);
    const buffer = await this.contenido(dto, formato);

    // QA-DOC54-04: descargar es lectura. Solo quien puede cambiar el estado (mismo rol que el PATCH)
    // lo marca "exportado" al exportar; un perfil de solo lectura descarga sin alterar el reporte.
    const puedeEscribir = (GENERAN_REPORTES as readonly string[]).includes(usuario.rol);
    if (puedeEscribir && doc.estado !== ESTADO_REPORTE.EXPORTADO) {
      doc.estado = ESTADO_REPORTE.EXPORTADO;
      await doc.save();
    }
    // D-46: cada descarga queda en la bitácora con quién (el token), cuándo y qué formato.
    await this.audit.reportar(
      {
        tabla: 'reportes',
        registroId: dto.id,
        accion: 'exportar',
        descripcion: `Reporte ejecutivo exportado a ${NOMBRE_FORMATO[formato]} (formato=${formato}) por ${usuario.rol}.`,
        ip: ip ?? null,
      },
      authorization,
    );
    return { buffer, nombre: nombreDescarga(dto, formato), formato };
  }

  /** Bytes del archivo a partir del reporte GUARDADO: mismos números que el JSON. */
  async contenido(dto: ReporteDto, formato: FormatoExportacion): Promise<Buffer> {
    return formato === 'xlsx' ? this.excel.generar(dto) : formato === 'csv' ? generarCsv(dto) : this.pdf.generar(dto);
  }

  /** El reporte con la regla de acceso (404 si es ajeno para un Proveedor), ya en su forma pública. */
  async buscarDto(id: string, usuario: SesionUsuario): Promise<ReporteDto> {
    return this.aDto(await this.buscar(id, usuario));
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
