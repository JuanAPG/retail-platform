import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * Estados del archivo. `disponible` solo se pone DESPUÉS de comprobar en el
 * almacén que el objeto existe con el tamaño esperado: el registro nunca
 * anuncia un archivo que no está.
 */
export const ESTADO_ARCHIVO = { PENDIENTE: 'pendiente', DISPONIBLE: 'disponible', FALLIDO: 'fallido' } as const;
export type EstadoArchivo = (typeof ESTADO_ARCHIVO)[keyof typeof ESTADO_ARCHIVO];

/**
 * Colección `archivos` (MongoDB): registro de archivo estable (contrato
 * docs/contratos/registro-archivos.md, versión 1). Un registro por reporte y
 * formato: el reporte guardado no cambia, así que su archivo tampoco.
 */
@Schema({ collection: 'archivos', versionKey: false })
export class Archivo {
  /** UUID del archivo. Es lo que se publica; la ruta del objeto no. */
  @Prop({ type: String, required: true })
  _id!: string;

  @Prop({ required: true, default: 1 })
  versionContrato!: number;

  @Prop({ required: true })
  dominio!: string;

  @Prop({ required: true })
  recursoTipo!: string;

  @Prop({ required: true })
  recursoId!: string;

  @Prop({ required: true })
  formato!: string;

  @Prop({ required: true })
  almacen!: string;

  @Prop({ required: true })
  bucket!: string;

  /** Ruta del objeto: generada por el servicio, NUNCA el nombre que manda el usuario. */
  @Prop({ type: String, default: null })
  ruta!: string | null;

  @Prop({ required: true })
  tipoContenido!: string;

  @Prop({ type: Number, default: null })
  tamanoBytes!: number | null;

  @Prop({ type: String, default: null })
  sha256!: string | null;

  /** Dueño del recurso (quien generó el reporte): con esto se decide el acceso de un Proveedor. */
  @Prop({ required: true })
  propietarioId!: string;

  @Prop({ required: true })
  solicitadoPor!: string;

  @Prop({ required: true, default: 'privado' })
  privacidad!: string;

  @Prop({ required: true, enum: Object.values(ESTADO_ARCHIVO) })
  estado!: EstadoArchivo;

  @Prop({ required: true, default: 0 })
  intentos!: number;

  @Prop({ type: String, default: null })
  ultimoError!: string | null;

  /** Candado de generación: mientras no venza, otro intento no sube un segundo objeto. */
  @Prop({ type: Date, default: null })
  enCursoHasta!: Date | null;

  /** Cuándo se emitió el aviso de "disponible". Con esto un reintento no duplica avisos. */
  @Prop({ type: Date, default: null })
  avisoEmitidoEn!: Date | null;

  @Prop({ required: true, default: 0 })
  urlsEmitidas!: number;

  @Prop({ type: Date, default: null })
  ultimaUrlEn!: Date | null;

  /** Lecturas efectivas del objeto (solo el doble local las ve; en GCS están en Cloud Audit Logs). */
  @Prop({ required: true, default: 0 })
  lecturas!: number;

  @Prop({ type: String, default: null })
  correlationId!: string | null;

  @Prop({ type: Object, default: {} })
  metadatos!: Record<string, unknown>;

  @Prop({ required: true })
  creadoEn!: Date;

  @Prop({ required: true })
  actualizadoEn!: Date;

  @Prop({ type: Date, default: null })
  disponibleEn!: Date | null;
}

export type ArchivoDocument = HydratedDocument<Archivo>;
export const ArchivoSchema = SchemaFactory.createForClass(Archivo);

// Idempotencia: un archivo por recurso y formato (dos peticiones simultáneas no crean dos).
ArchivoSchema.index({ dominio: 1, recursoTipo: 1, recursoId: 1, formato: 1 }, { unique: true });
ArchivoSchema.index({ propietarioId: 1, creadoEn: -1 });
