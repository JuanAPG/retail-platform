import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export interface RespuestaEncuesta {
  preguntaId: string;
  pregunta: string;
  respuesta: string | number | boolean;
}

/**
 * Colección `visitas_campo` (MongoDB, D-30): ubicación de la visita (RF-37) y
 * respuestas de encuesta (RF-38) capturadas en la app móvil. Solo se anexa.
 * `_id` es el `visitId` del dispositivo: un reenvío no crea otra (D-42).
 */
@Schema({ collection: 'visitas_campo', versionKey: false })
export class VisitaCampo {
  @Prop({ type: String, required: true })
  _id!: string;

  @Prop({ required: true })
  tiendaId!: string;

  /** Zona de la tienda al momento de la visita: los análisis son por zona agregada. */
  @Prop({ type: String, default: null })
  zonaId!: string | null;

  @Prop({ required: true })
  visitadaEn!: Date;

  /** GeoJSON Point [lng, lat]. */
  @Prop({ type: Object, required: true })
  ubicacion!: { type: 'Point'; coordinates: [number, number] };

  @Prop({ type: Number, default: null })
  precisionM!: number | null;

  @Prop({ type: [Object], default: [] })
  respuestas!: RespuestaEncuesta[];

  @Prop({ type: String, default: null })
  notas!: string | null;

  @Prop({ required: true })
  capturadoPor!: string;

  @Prop({ type: String, default: null })
  correlationId!: string | null;

  @Prop({ required: true })
  recibidaEn!: Date;
}

export type VisitaCampoDocument = HydratedDocument<VisitaCampo>;
export const VisitaCampoSchema = SchemaFactory.createForClass(VisitaCampo);
VisitaCampoSchema.index({ tiendaId: 1, visitadaEn: -1 });
VisitaCampoSchema.index({ capturadoPor: 1, visitadaEn: -1 });
VisitaCampoSchema.index({ ubicacion: '2dsphere' });
