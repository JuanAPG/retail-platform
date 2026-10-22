import { randomUUID } from 'crypto';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/** Valores de `dimension` de un filtro (los mismos del enum `dimension_analisis`). */
export type DimensionFiltro = 'tienda' | 'zona' | 'segmento' | 'categoria' | 'producto';

export type LadoRegla = 'antecedente' | 'consecuente';

export type EstadoCorrida = 'completada' | 'fallida';

export interface ParametroCorrida {
  key: string;
  value: string;
}

export interface FiltroCorrida {
  dimension: DimensionFiltro;
  referenceId: string;
}

export interface ItemRegla {
  productId: string;
  side: LadoRegla;
}

export interface ReglaGuardada {
  id: string;
  support: number;
  confidence: number;
  lift: number | null;
  transactionCount: number | null;
  items: ItemRegla[];
}

/**
 * Foto de los datos de la corrida (D-15): el hash de las canastas tal como
 * entraron al algoritmo (cada una como conjunto ordenado de productos, y la
 * lista ordenada). Dos corridas con el mismo hash y los mismos parámetros
 * corrieron sobre los mismos datos y tienen que dar las mismas reglas.
 */
export interface FotoDatos {
  hash: string;
  baskets: number;
}

/**
 * Corrida de Apriori o FP-Growth en MongoDB (D3), colección `analysis_runs`:
 * la misma que usa analytics-stats para el clustering, separadas por `type`.
 * Cada documento es la corrida completa (parámetros, supuestos, filtros,
 * reglas y la foto de los datos), así que se lee de una sola vez.
 */
@Schema({ collection: 'analysis_runs', versionKey: false })
export class CorridaAsociacionMongo {
  /** UUID v4 y no ObjectId: el contrato y `ParseUUIDPipe` exponen ids UUID. */
  @Prop({ type: String, default: () => randomUUID() })
  _id!: string;

  @Prop({ required: true, enum: ['asociacion'], default: 'asociacion' })
  type!: 'asociacion';

  @Prop({ required: true, enum: ['completada', 'fallida'] })
  status!: EstadoCorrida;

  /** Solo el id del usuario (D-26); el nombre lo resuelve quien responde. */
  @Prop({ type: String, default: null })
  userId!: string | null;

  /** Cuándo se ejecutó; no confundir con el periodo de los datos. */
  @Prop({ required: true, default: () => new Date() })
  date!: Date;

  /** Periodo de los DATOS analizados, 'yyyy-mm-dd'. */
  @Prop({ required: true })
  periodStart!: string;

  @Prop({ required: true })
  periodEnd!: string;

  @Prop({ type: Number, default: null })
  transactionsConsidered!: number | null;

  @Prop({ type: Number, default: null })
  basketsConsidered!: number | null;

  /** Obligatorio cuando `status` es `fallida`. */
  @Prop({ type: String, default: null })
  errorMessage!: string | null;

  @Prop({ type: [{ _id: false, key: String, value: String }], default: [] })
  parameters!: ParametroCorrida[];

  /** En orden: el número de cada supuesto es su posición + 1. */
  @Prop({ type: [String], default: [] })
  assumptions!: string[];

  @Prop({ type: [{ _id: false, dimension: String, referenceId: String }], default: [] })
  filters!: FiltroCorrida[];

  @Prop({
    type: [
      {
        _id: false,
        id: String,
        support: Number,
        confidence: Number,
        lift: { type: Number, default: null },
        transactionCount: { type: Number, default: null },
        items: [{ _id: false, productId: String, side: String }],
      },
    ],
    default: [],
  })
  results!: ReglaGuardada[];

  /** Sin foto en una corrida fallida antes de agrupar las canastas. */
  @Prop({ type: { _id: false, hash: String, baskets: Number }, default: null })
  snapshot!: FotoDatos | null;
}

export type CorridaAsociacionDocument = HydratedDocument<CorridaAsociacionMongo>;
export const CorridaAsociacionSchema = SchemaFactory.createForClass(CorridaAsociacionMongo);

// El historial: corridas de un tipo, de la más reciente a la más antigua.
CorridaAsociacionSchema.index({ type: 1, date: -1 }, { name: 'type_date' });
