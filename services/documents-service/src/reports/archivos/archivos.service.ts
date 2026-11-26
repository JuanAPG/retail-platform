import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { createHash, randomUUID } from 'crypto';
import { Connection, Model } from 'mongoose';
import { AuditReporter } from '../../common/audit/audit-reporter.service';
import { SesionUsuario } from '../../common/auth/session.guard';
import { correlacionActual } from '../../common/correlation/correlacion';
import { NotificationsReporter } from '../../common/notifications/notifications-reporter.service';
import { FormatoExportacion } from '../dto/reports.dto';
import { nombreDescarga, ReporteDto, ReportsService, TIPO_CONTENIDO } from '../reports.service';
import { ALMACEN_OBJETOS, AlmacenNoDisponibleError, AlmacenObjetos, motivoSeguro, ttlConfigurado } from './almacen/almacen';
import { asegurarMongo } from '../../common/mongo/asegurar-mongo';
import { Archivo, ArchivoDocument, ESTADO_ARCHIVO } from './archivo.schema';

export const DOMINIO = 'reportes';
export const RECURSO = 'reporte';
/** Cuánto dura el candado de una generación en curso antes de que otro intento pueda tomarla. */
const CANDADO_MS = 60_000;

/** Forma pública del registro (JSON y XML). Nunca lleva la URL firmada ni la ruta física local. */
export interface ArchivoDto {
  id: string;
  versionContrato: number;
  dominio: string;
  recursoTipo: string;
  recursoId: string;
  formato: string;
  almacen: string;
  bucket: string;
  ruta: string | null;
  tipoContenido: string;
  tamanoBytes: number | null;
  sha256: string | null;
  propietarioId: string;
  privacidad: string;
  estado: string;
  intentos: number;
  ultimoError: string | null;
  urlsEmitidas: number;
  lecturas: number;
  correlationId: string | null;
  metadatos: Record<string, unknown>;
  creadoEn: Date;
  actualizadoEn: Date;
  disponibleEn: Date | null;
}

export interface ResultadoPreparar {
  archivo: ArchivoDto;
  /** 201 = se generó ahora, 200 = ya estaba disponible, 202 = otro intento lo está generando. */
  status: 200 | 201 | 202;
}

export interface UrlDescargaDto {
  archivoId: string;
  url: string;
  expiraEn: Date;
  ttlSegundos: number;
  nombre: string;
  tipoContenido: string;
  tamanoBytes: number;
  sha256: string;
}

@Injectable()
export class ArchivosService {
  private readonly logger = new Logger(ArchivosService.name);

  constructor(
    @InjectModel(Archivo.name) private readonly modelo: Model<ArchivoDocument>,
    @InjectConnection() private readonly conexion: Connection,
    @Inject(ALMACEN_OBJETOS) private readonly almacen: AlmacenObjetos,
    private readonly reportes: ReportsService,
    private readonly audit: AuditReporter,
    private readonly avisos: NotificationsReporter,
  ) {}

  private async exigirMongo(): Promise<void> {
    if (!(await asegurarMongo(this.conexion))) {
      throw new ServiceUnavailableException('El registro de archivos (MongoDB) no está disponible. Intenta más tarde.');
    }
  }

  /**
   * Genera (o devuelve) el archivo privado de un reporte guardado en un formato.
   * Idempotente por (reporte, formato): repetir la petición no sube otro objeto
   * ni repite el aviso. Si el almacén falla, el registro queda `fallido` con el
   * motivo y la misma petición lo reintenta.
   */
  async preparar(
    reporteId: string,
    formato: FormatoExportacion,
    usuario: SesionUsuario,
    authorization: string | undefined,
    ip?: string,
  ): Promise<ResultadoPreparar> {
    // Autorización por recurso ANTES de tocar el registro: un Proveedor con un reporte ajeno recibe 404.
    const reporte = await this.reportes.buscarDto(reporteId, usuario);
    await this.exigirMongo();

    let doc = await this.obtenerOCrear(reporte, formato, usuario);

    if (doc.estado === ESTADO_ARCHIVO.DISPONIBLE) {
      let presente: boolean;
      try {
        presente = await this.objetoPresente(doc);
      } catch (error) {
        throw new ServiceUnavailableException(`El almacén de archivos no responde: ${motivoSeguro(error)}`);
      }
      if (presente) {
        await this.avisarUnaVez(doc, authorization);
        return { archivo: this.aDto(doc), status: 200 };
      }
      // El objeto desapareció del almacén: el registro deja de anunciarlo y se regenera.
      doc = await this.marcarFallido(doc._id, 'El objeto ya no está en el almacén; se regenera.');
    }

    // Candado atómico: solo un intento a la vez sube el objeto.
    const ahora = new Date();
    const tomado = await this.modelo.findOneAndUpdate(
      {
        _id: doc._id,
        estado: { $ne: ESTADO_ARCHIVO.DISPONIBLE },
        $or: [{ enCursoHasta: null }, { enCursoHasta: { $lt: ahora } }],
      },
      {
        $set: { estado: ESTADO_ARCHIVO.PENDIENTE, enCursoHasta: new Date(ahora.getTime() + CANDADO_MS), actualizadoEn: ahora },
        $inc: { intentos: 1 },
      },
      { new: true },
    );
    if (!tomado) {
      const actual = await this.modelo.findById(doc._id);
      return { archivo: this.aDto(actual ?? doc), status: actual?.estado === ESTADO_ARCHIVO.DISPONIBLE ? 200 : 202 };
    }

    const contenido = await this.reportes.contenido(reporte, formato);
    const sha256 = createHash('sha256').update(contenido).digest('hex');
    const tipoContenido = TIPO_CONTENIDO[formato];
    // Ruta generada aquí, independiente de cualquier nombre que mande el usuario. Un intento = una ruta:
    // GCS no sobrescribe (ifGenerationMatch: 0), así un reintento nunca pisa un objeto a medias.
    const ruta = `${DOMINIO}/${reporte.creadoEn.toISOString().slice(0, 7).replace('-', '/')}/${reporte.id}/${tomado._id}-${tomado.intentos}.${formato}`;

    try {
      const guardado = await this.almacen.guardar(ruta, contenido, tipoContenido, {
        archivoId: tomado._id,
        recursoId: reporte.id,
        sha256,
        ...(correlacionActual() ? { correlationId: correlacionActual()! } : {}),
      });
      if (guardado.tamanoBytes !== contenido.length) {
        throw new AlmacenNoDisponibleError(`El almacén reporta ${guardado.tamanoBytes} bytes y se subieron ${contenido.length}.`);
      }
      const listo = await this.modelo.findOneAndUpdate(
        { _id: tomado._id },
        {
          $set: {
            estado: ESTADO_ARCHIVO.DISPONIBLE,
            ruta,
            tamanoBytes: contenido.length,
            sha256,
            tipoContenido,
            ultimoError: null,
            enCursoHasta: null,
            disponibleEn: new Date(),
            actualizadoEn: new Date(),
            'metadatos.generacion': guardado.generacion,
          },
        },
        { new: true },
      );
      await this.audit.reportar(
        {
          tabla: 'archivos',
          registroId: tomado._id,
          accion: 'insert',
          descripcion: `Archivo ${formato.toUpperCase()} del reporte ${reporte.id} guardado en ${this.almacen.tipo} (${contenido.length} bytes, sha256 ${sha256.slice(0, 12)}…).`,
          ip: ip ?? null,
        },
        authorization,
      );
      await this.avisarUnaVez(listo!, authorization);
      return { archivo: this.aDto(listo!), status: 201 };
    } catch (error) {
      const motivo = motivoSeguro(error);
      this.logger.warn(`Archivo ${tomado._id} fallido (intento ${tomado.intentos}): ${motivo}`);
      await this.marcarFallido(tomado._id, motivo);
      throw new ServiceUnavailableException(
        `El almacén de archivos no está disponible; el archivo ${tomado._id} quedó como fallido y se puede reintentar con la misma petición.`,
      );
    }
  }

  async listar(reporteId: string, usuario: SesionUsuario): Promise<ArchivoDto[]> {
    await this.reportes.buscarDto(reporteId, usuario);
    await this.exigirMongo();
    const docs = await this.modelo.find({ dominio: DOMINIO, recursoTipo: RECURSO, recursoId: reporteId }).sort({ formato: 1 });
    return docs.map((d) => this.aDto(d));
  }

  async obtener(reporteId: string, archivoId: string, usuario: SesionUsuario): Promise<ArchivoDto> {
    return this.aDto(await this.buscar(reporteId, archivoId, usuario));
  }

  /**
   * URL firmada de vida corta. Primero se autoriza (Matriz por rol en el
   * controlador + propiedad del reporte aquí), después se comprueba que el
   * objeto exista y hasta entonces se firma. La URL no se guarda ni se loguea;
   * la bitácora registra que se EMITIÓ (no que se leyó).
   */
  async emitirUrl(
    reporteId: string,
    archivoId: string,
    usuario: SesionUsuario,
    authorization: string | undefined,
    ip?: string,
  ): Promise<UrlDescargaDto> {
    const doc = await this.buscar(reporteId, archivoId, usuario);
    if (doc.estado !== ESTADO_ARCHIVO.DISPONIBLE || !doc.ruta || doc.sha256 == null || doc.tamanoBytes == null) {
      throw new ConflictException(`El archivo todavía no está disponible (estado: ${doc.estado}).`);
    }
    let presente: boolean;
    try {
      presente = await this.objetoPresente(doc);
    } catch (error) {
      throw new ServiceUnavailableException(`El almacén de archivos no responde: ${motivoSeguro(error)}`);
    }
    if (!presente) {
      await this.marcarFallido(doc._id, 'El objeto ya no está en el almacén; se regenera.');
      throw new ConflictException('El archivo ya no está en el almacén; vuelve a prepararlo.');
    }

    const ttl = ttlConfigurado();
    const nombre = nombreDescarga({ creadoEn: new Date(String(doc.metadatos?.reporteCreadoEn ?? doc.creadoEn)) }, doc.formato as FormatoExportacion);
    let firmada;
    try {
      firmada = await this.almacen.firmarLectura(doc.ruta, { ttlSegundos: ttl, nombreDescarga: nombre, tipoContenido: doc.tipoContenido, archivoId: doc._id });
    } catch (error) {
      throw new ServiceUnavailableException(`No se pudo firmar la descarga: ${motivoSeguro(error)}`);
    }
    await this.modelo.updateOne({ _id: doc._id }, { $inc: { urlsEmitidas: 1 }, $set: { ultimaUrlEn: new Date() } });
    // D-46: quién, cuándo y qué. "URL emitida" ≠ "objeto leído" (la lectura la registra el almacén).
    await this.audit.reportar(
      {
        tabla: 'archivos',
        registroId: doc._id,
        accion: 'exportar',
        descripcion: `URL de descarga emitida para el reporte ${reporteId} en ${doc.formato.toUpperCase()} por ${usuario.rol}; vence ${firmada.expiraEn.toISOString()} (${ttl} s).`,
        ip: ip ?? null,
      },
      authorization,
    );
    return {
      archivoId: doc._id,
      url: firmada.url,
      expiraEn: firmada.expiraEn,
      ttlSegundos: ttl,
      nombre,
      tipoContenido: doc.tipoContenido,
      tamanoBytes: doc.tamanoBytes,
      sha256: doc.sha256,
    };
  }

  /** Registro por id sin regla de usuario: lo usa SOLO la descarga local, que ya validó la firma. */
  async porIdParaDescargaLocal(archivoId: string): Promise<ArchivoDocument | null> {
    await this.exigirMongo();
    return this.modelo.findById(archivoId);
  }

  async registrarLectura(archivoId: string): Promise<void> {
    await this.modelo.updateOne({ _id: archivoId }, { $inc: { lecturas: 1 } });
  }

  // ---------------------------------------------------------------------------

  private async obtenerOCrear(reporte: ReporteDto, formato: FormatoExportacion, usuario: SesionUsuario): Promise<ArchivoDocument> {
    const filtro = { dominio: DOMINIO, recursoTipo: RECURSO, recursoId: reporte.id, formato };
    const ahora = new Date();
    try {
      const doc = await this.modelo.findOneAndUpdate(
        filtro,
        {
          $setOnInsert: {
            _id: randomUUID(),
            versionContrato: 1,
            almacen: this.almacen.tipo,
            bucket: this.almacen.bucket,
            ruta: null,
            tipoContenido: TIPO_CONTENIDO[formato],
            tamanoBytes: null,
            sha256: null,
            propietarioId: reporte.usuarioId,
            solicitadoPor: usuario.id,
            privacidad: 'privado',
            estado: ESTADO_ARCHIVO.PENDIENTE,
            intentos: 0,
            ultimoError: null,
            enCursoHasta: null,
            avisoEmitidoEn: null,
            urlsEmitidas: 0,
            ultimaUrlEn: null,
            lecturas: 0,
            correlationId: correlacionActual() ?? null,
            metadatos: {
              reporteCreadoEn: reporte.creadoEn,
              tipoReporte: reporte.tipo,
              indicadoresNoDisponibles: reporte.secciones.filter((s) => !s.disponible).length,
            },
            creadoEn: ahora,
            actualizadoEn: ahora,
            disponibleEn: null,
          },
        },
        { upsert: true, new: true },
      );
      return doc!;
    } catch (error) {
      // Dos peticiones simultáneas: la que perdió el índice único lee la que ganó.
      if ((error as { code?: number }).code === 11000) return (await this.modelo.findOne(filtro))!;
      throw error;
    }
  }

  private async buscar(reporteId: string, archivoId: string, usuario: SesionUsuario): Promise<ArchivoDocument> {
    await this.reportes.buscarDto(reporteId, usuario);
    await this.exigirMongo();
    const doc = await this.modelo.findOne({ _id: archivoId, dominio: DOMINIO, recursoTipo: RECURSO, recursoId: reporteId });
    if (!doc) throw new NotFoundException('El archivo no existe.');
    return doc;
  }

  private async objetoPresente(doc: ArchivoDocument): Promise<boolean> {
    if (!doc.ruta || doc.tamanoBytes == null) return false;
    return (await this.almacen.tamano(doc.ruta)) === doc.tamanoBytes;
  }

  private async marcarFallido(id: string, motivo: string): Promise<ArchivoDocument> {
    const doc = await this.modelo.findOneAndUpdate(
      { _id: id },
      { $set: { estado: ESTADO_ARCHIVO.FALLIDO, ultimoError: motivo, enCursoHasta: null, actualizadoEn: new Date() } },
      { new: true },
    );
    return doc!;
  }

  /**
   * Aviso de "archivo disponible" UNA sola vez: se reclama atómicamente
   * (`avisoEmitidoEn: null → ahora`) y si notifications lo rechaza se libera
   * para que una petición posterior lo intente de nuevo.
   */
  private async avisarUnaVez(doc: ArchivoDocument, authorization: string | undefined): Promise<void> {
    const reclamado = await this.modelo.updateOne({ _id: doc._id, avisoEmitidoEn: null }, { $set: { avisoEmitidoEn: new Date() } });
    if (reclamado.modifiedCount !== 1) return;
    const aceptado = await this.avisos.emitir(
      {
        eventType: 'reporte.disponible',
        relatedEntityType: 'reporte',
        relatedEntityId: doc.recursoId,
        title: 'Tu reporte ya se puede descargar',
        message: `El reporte ejecutivo en ${doc.formato.toUpperCase()} está listo para descargar.`,
        recipientUserId: doc.solicitadoPor,
      },
      authorization,
    );
    if (!aceptado) await this.modelo.updateOne({ _id: doc._id }, { $set: { avisoEmitidoEn: null } });
  }

  aDto(d: ArchivoDocument): ArchivoDto {
    return {
      id: d._id,
      versionContrato: d.versionContrato,
      dominio: d.dominio,
      recursoTipo: d.recursoTipo,
      recursoId: d.recursoId,
      formato: d.formato,
      almacen: d.almacen,
      bucket: d.bucket,
      ruta: d.ruta,
      tipoContenido: d.tipoContenido,
      tamanoBytes: d.tamanoBytes,
      sha256: d.sha256,
      propietarioId: d.propietarioId,
      privacidad: d.privacidad,
      estado: d.estado,
      intentos: d.intentos,
      ultimoError: d.ultimoError,
      urlsEmitidas: d.urlsEmitidas,
      lecturas: d.lecturas,
      correlationId: d.correlationId,
      metadatos: d.metadatos ?? {},
      creadoEn: d.creadoEn,
      actualizadoEn: d.actualizadoEn,
      disponibleEn: d.disponibleEn,
    };
  }
}
