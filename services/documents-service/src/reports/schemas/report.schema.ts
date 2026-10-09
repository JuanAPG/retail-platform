import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export const ESTADO_REPORTE = { GENERADO: 'generado', EXPORTADO: 'exportado' } as const;
export type EstadoReporte = (typeof ESTADO_REPORTE)[keyof typeof ESTADO_REPORTE];

/** Un indicador del reporte. Si su servicio no respondió: `disponible: false`, NUNCA un 0. */
export interface Indicador {
  clave: string;
  nombre: string;
  servicio: string;
  disponible: boolean;
  /** Número, texto, lista u objeto según el indicador; `null` cuando no está disponible. */
  valor: unknown;
  /** Por qué no está disponible (timeout, 5xx…); `null` cuando sí lo está. */
  motivo: string | null;
}

export interface ParametrosReporte {
  dateFrom: string;
  dateTo: string;
  zoneId: string | null;
  segmentId: number | null;
}

/**
 * Colección `reportes`: historial de reportes ejecutivos (DOC-03).
 * Se guarda el reporte COMPLETO (`secciones`) para que el PDF y el JSON salgan
 * del mismo documento y un reporte viejo no cambie aunque cambien los datos.
 */
@Schema({ collection: 'reportes', versionKey: false })
export class Reporte {
  @Prop({ required: true })
  tipo!: string;

  @Prop({ type: Object, required: true })
  parametros!: ParametrosReporte;

  @Prop({ required: true, default: 'json' })
  formato!: string;

  @Prop({ required: true })
  usuarioId!: string;

  @Prop({ required: true, enum: Object.values(ESTADO_REPORTE), default: ESTADO_REPORTE.GENERADO })
  estado!: EstadoReporte;

  @Prop({ required: true, default: () => new Date() })
  creadoEn!: Date;

  @Prop({ type: [Object], required: true })
  secciones!: Indicador[];
}

export type ReporteDocument = HydratedDocument<Reporte>;
export const ReporteSchema = SchemaFactory.createForClass(Reporte);

// Consultas del historial de un usuario (la más usada) y por tipo, siempre por fecha desc.
ReporteSchema.index({ usuarioId: 1, creadoEn: -1 });
ReporteSchema.index({ tipo: 1, creadoEn: -1 });
