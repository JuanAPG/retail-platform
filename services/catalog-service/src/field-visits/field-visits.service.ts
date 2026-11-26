import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { InjectDataSource } from '@nestjs/typeorm';
import { Connection, Model } from 'mongoose';
import { DataSource } from 'typeorm';
import { AuditReporter } from '../common/audit/audit-reporter.service';
import { SesionUsuario } from '../common/auth/session.guard';
import { correlacionActual } from '../common/correlation/correlacion';
import { asegurarMongo } from '../common/mongo/asegurar-mongo';
import { CreateFieldVisitDto } from './dto/create-field-visit.dto';
import { VisitaCampo, VisitaCampoDocument } from './visita-campo.schema';

/** Forma pública de una visita (JSON y XML `fieldVisitResponse`). */
export interface FieldVisitDto {
  visitId: string;
  storeId: string;
  zoneId: string | null;
  visitedAt: Date;
  lat: number;
  lng: number;
  accuracyM: number | null;
  answers: { preguntaId: string; pregunta: string; respuesta: string | number | boolean }[];
  notes: string | null;
  capturedBy: string;
  receivedAt: Date;
}

/** Margen por relojes de teléfono desfasados, igual que las observaciones de precio. */
const MARGEN_FUTURO_MS = 5 * 60 * 1000;

@Injectable()
export class FieldVisitsService {
  constructor(
    @InjectModel(VisitaCampo.name) private readonly modelo: Model<VisitaCampoDocument>,
    @InjectConnection() private readonly mongo: Connection,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditReporter,
  ) {}

  /**
   * Registra una visita. Idempotente por `visitId` (D-42): el mismo usuario
   * reenviándola recibe la original (`duplicada`); otro usuario con ese id, 409.
   * Mongo caído → 503 (D-25): el dispositivo la conserva y reintenta.
   */
  async registrar(
    dto: CreateFieldVisitDto,
    usuario: SesionUsuario,
    token?: string,
    ip?: string,
  ): Promise<{ visita: FieldVisitDto; duplicada: boolean }> {
    if (!(await asegurarMongo(this.mongo))) {
      throw new ServiceUnavailableException('Las visitas de campo (MongoDB) no están disponibles. El dispositivo debe reintentar.');
    }
    const previa = await this.modelo.findById(dto.visitId);
    if (previa) return { visita: this.revisarDueno(previa, usuario), duplicada: true };

    const visitadaEn = new Date(dto.visitedAt);
    if (visitadaEn.getTime() > Date.now() + MARGEN_FUTURO_MS) throw new BadRequestException('visitedAt no puede ser una fecha futura.');
    const [tienda] = await this.dataSource.query('SELECT zona_id, activo FROM tiendas WHERE id = $1', [dto.storeId]);
    if (!tienda) throw new BadRequestException('La tienda indicada no existe.');
    if (tienda.activo === false) throw new ConflictException('La tienda está dada de baja: no se le registran visitas.');

    let doc: VisitaCampoDocument;
    try {
      doc = await this.modelo.create({
        _id: dto.visitId,
        tiendaId: dto.storeId,
        zonaId: tienda.zona_id ?? null,
        visitadaEn,
        ubicacion: { type: 'Point', coordinates: [dto.lng, dto.lat] },
        precisionM: dto.accuracyM ?? null,
        respuestas: (dto.answers ?? []).map((a) => ({ preguntaId: a.preguntaId, pregunta: a.pregunta, respuesta: a.respuesta })),
        notas: dto.notes ?? null,
        capturadoPor: usuario.id,
        correlationId: correlacionActual() ?? null,
        recibidaEn: new Date(),
      });
    } catch (error) {
      // Dos reenvíos simultáneos: el que pierde la clave lee la del que ganó.
      if ((error as { code?: number }).code === 11000) {
        const ganadora = await this.modelo.findById(dto.visitId);
        if (ganadora) return { visita: this.revisarDueno(ganadora, usuario), duplicada: true };
      }
      throw error;
    }

    await this.audit.reportar(
      {
        tabla: 'visitas_campo',
        registroId: doc._id,
        accion: 'insert',
        descripcion: `Visita de campo a la tienda ${dto.storeId} con ${doc.respuestas.length} respuesta(s) de encuesta.`,
        ip: ip ?? null,
      },
      token,
    );
    return { visita: this.aDto(doc), duplicada: false };
  }

  /** El mismo id de otro usuario es 409 y NO revela la visita ajena. */
  private revisarDueno(doc: VisitaCampoDocument, usuario: SesionUsuario): FieldVisitDto {
    if (doc.capturadoPor !== usuario.id) {
      throw new ConflictException('Ese visitId ya se usó en otra captura. Genera uno nuevo en el dispositivo.');
    }
    return this.aDto(doc);
  }

  private aDto(d: VisitaCampoDocument): FieldVisitDto {
    return {
      visitId: d._id,
      storeId: d.tiendaId,
      zoneId: d.zonaId,
      visitedAt: d.visitadaEn,
      lat: d.ubicacion.coordinates[1],
      lng: d.ubicacion.coordinates[0],
      accuracyM: d.precisionM,
      answers: d.respuestas,
      notes: d.notas,
      capturedBy: d.capturadoPor,
      receivedAt: d.recibidaEn,
    };
  }
}
