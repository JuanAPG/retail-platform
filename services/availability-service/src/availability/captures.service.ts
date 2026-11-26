import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, QueryFailedError } from 'typeorm';
import { armarPagina, limites } from '../common/dto/pagina.dto';
import { Pagina } from '../common/dto/pagination.dto';
import { diasDeVigencia, edadEnDias, estadoExistencia, EstadoExistencia } from './cobertura';
import { CaptureFilterDto, CreateCaptureDto, OrigenCaptura, StockFilterDto } from './dto/availability.dto';

/** Una captura. El orden de los campos es el del XSD. */
export interface Capture {
  captureId: string;
  status: 'aceptada' | 'conflicto' | 'duplicada';
  storeId: string;
  presentationId: string;
  stock: number;
  capturedAt: Date;
  receivedAt: Date;
  origin: OrigenCaptura;
  capturedBy: string | null;
  /** Solo en la respuesta del POST: la existencia que quedó en el servidor. */
  currentStock?: number;
  currentCapturedAt?: Date;
  reason: string | null;
  /**
   * Solo en un `duplicada` (200): el estado con que se registró la captura la primera vez
   * (`aceptada` o `conflicto`). Para que offline-sync no tenga que leerlo del texto de `reason`.
   */
  originalStatus?: 'aceptada' | 'conflicto';
}

export interface StockRow {
  storeId: string;
  presentationId: string;
  stock: number;
  capturedAt: Date;
  ageDays: number;
  status: EstadoExistencia;
}

type Fila = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Una captura puede llegar con el reloj del dispositivo un poco adelantado; más que esto es un error. */
const TOLERANCIA_FUTURO_MS = 5 * 60 * 1000;

const SELECT_CAPTURA = `
  SELECT captura_id, estado, tienda_id, presentacion_id, stock, capturado_en, recibido_en,
         origen, capturado_por, motivo
  FROM disponibilidad_capturas`;

function aCaptura(f: Fila): Capture {
  return {
    captureId: f.captura_id,
    status: f.estado,
    storeId: f.tienda_id,
    presentationId: f.presentacion_id,
    stock: Number(f.stock),
    capturedAt: f.capturado_en,
    receivedAt: f.recibido_en,
    origin: f.origen,
    capturedBy: f.capturado_por,
    reason: f.motivo,
  };
}

/** Agrega la existencia que quedó en el servidor, con los campos en el orden del XSD (`reason` al final). */
function conExistenciaActual(captura: Capture, actual: Fila | undefined): Capture {
  const { reason, ...resto } = captura;
  return {
    ...resto,
    ...(actual ? { currentStock: Number(actual.stock_disponible), currentCapturedAt: actual.actualizado_en } : {}),
    reason,
  };
}

function codigoPg(error: unknown): string | undefined {
  return error instanceof QueryFailedError ? (error as unknown as { code?: string }).code : undefined;
}

/**
 * Capturas de existencia y existencia actual (D-38).
 *
 * `inventario` guarda la existencia ACTUAL por tienda y presentación, y
 * `actualizado_en` es cuándo se VIO ese dato. `disponibilidad_capturas` es la
 * bitácora (solo se anexa) y da la idempotencia por `captura_id` (D-42).
 */
@Injectable()
export class CapturesService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Registra una captura. Gana el dato que se CAPTURÓ más tarde, no el que se
   * subió más tarde (D-42): una captura del lunes sincronizada el viernes no
   * pisa una del jueves; queda guardada como `conflicto`.
   */
  async capture(
    dto: CreateCaptureDto,
    usuarioId: string,
  ): Promise<{ capture: Capture; previo: number | null }> {
    const capturedAt = dto.capturedAt ? new Date(dto.capturedAt) : new Date();
    if (capturedAt.getTime() > Date.now() + TOLERANCIA_FUTURO_MS) {
      throw new BadRequestException('capturedAt no puede ser una fecha futura.');
    }
    const captureId = dto.captureId ?? randomUUID();

    const repetida = await this.repetida(captureId, usuarioId);
    if (repetida) return { capture: repetida, previo: null };

    try {
      return await this.dataSource.transaction(async (manager) => {
        const [antes] = await manager.query(
          'SELECT stock_disponible FROM inventario WHERE tienda_id = $1 AND presentacion_id = $2',
          [dto.storeId, dto.presentationId],
        );
        // Una sola sentencia decide: inserta si no había dato, o actualiza SOLO si
        // esta captura es más reciente que el dato del servidor. Sin fila de vuelta = conflicto.
        const [aplicada] = await manager.query(
          `INSERT INTO inventario (tienda_id, presentacion_id, stock_disponible, actualizado_en)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (tienda_id, presentacion_id) DO UPDATE
             SET stock_disponible = EXCLUDED.stock_disponible, actualizado_en = EXCLUDED.actualizado_en
             WHERE inventario.actualizado_en < EXCLUDED.actualizado_en
           RETURNING stock_disponible`,
          [dto.storeId, dto.presentationId, dto.stock, capturedAt],
        );
        const [actual] = await manager.query(
          'SELECT stock_disponible, actualizado_en FROM inventario WHERE tienda_id = $1 AND presentacion_id = $2',
          [dto.storeId, dto.presentationId],
        );
        const motivo = aplicada
          ? null
          : `El servidor ya tiene un dato capturado después (${(actual.actualizado_en as Date).toISOString()}): esta captura no lo sobrescribe (D-42).`;
        const [fila] = await manager.query(
          `INSERT INTO disponibilidad_capturas
             (captura_id, tienda_id, presentacion_id, stock, capturado_en, origen, estado, motivo, capturado_por)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING captura_id, estado, tienda_id, presentacion_id, stock, capturado_en, recibido_en,
                     origen, capturado_por, motivo`,
          [captureId, dto.storeId, dto.presentationId, dto.stock, capturedAt, dto.origin ?? 'web',
           aplicada ? 'aceptada' : 'conflicto', motivo, usuarioId],
        );
        return {
          capture: conExistenciaActual(aCaptura(fila), actual),
          previo: antes ? Number(antes.stock_disponible) : null,
        };
      });
    } catch (error) {
      const codigo = codigoPg(error);
      // 23503: la tienda o la presentación no existen (llave foránea).
      if (codigo === '23503') {
        throw new BadRequestException('La tienda o la presentación no existen.');
      }
      // 23505: el mismo captureId llegó dos veces al mismo tiempo; la otra petición ganó.
      if (codigo === '23505') {
        const ganadora = await this.repetida(captureId, usuarioId);
        if (ganadora) return { capture: ganadora, previo: null };
      }
      throw error;
    }
  }

  /** Si el `captureId` ya se recibió, devuelve el resultado original como `duplicada` (no crea nada). */
  private async repetida(captureId: string, usuarioId: string): Promise<Capture | null> {
    const [fila] = await this.dataSource.query(`${SELECT_CAPTURA} WHERE captura_id = $1`, [captureId]);
    if (!fila) return null;
    if (fila.capturado_por !== usuarioId) {
      // No se revela nada de la captura de otro usuario.
      throw new ConflictException('Ese captureId ya fue usado por otra captura.');
    }
    const [actual] = await this.dataSource.query(
      'SELECT stock_disponible, actualizado_en FROM inventario WHERE tienda_id = $1 AND presentacion_id = $2',
      [fila.tienda_id, fila.presentacion_id],
    );
    const original = aCaptura(fila);
    return {
      ...conExistenciaActual(
        { ...original, status: 'duplicada', reason: `Captura ya recibida (${original.status}); no se registró de nuevo (D-42).` },
        actual,
      ),
      // Campo estable para offline-sync; el texto de `reason` puede cambiar.
      originalStatus: original.status as 'aceptada' | 'conflicto',
    };
  }

  /** Bitácora de capturas, la más reciente (por llegada) primero. */
  async findCaptures(filtros: CaptureFilterDto): Promise<Pagina<Capture>> {
    const { donde, valores } = condiciones([
      ['tienda_id = ?', filtros.storeId],
      ['presentacion_id = ?', filtros.presentationId],
      ['estado = ?', filtros.status],
    ]);
    const { page, limit, offset } = limites(filtros);
    const [filas, [{ total }]] = await Promise.all([
      this.dataSource.query(
        `${SELECT_CAPTURA} ${donde} ORDER BY recibido_en DESC, id DESC LIMIT $${valores.length + 1} OFFSET $${valores.length + 2}`,
        [...valores, limit, offset],
      ),
      this.dataSource.query(`SELECT COUNT(*)::int AS total FROM disponibilidad_capturas ${donde}`, valores),
    ]);
    return armarPagina(filas.map(aCaptura), total, page, limit);
  }

  /** Existencia actual, con su estado a la hora de la consulta (un dato de más de 7 días está vencido). */
  async findStock(filtros: StockFilterDto, ahora = new Date()): Promise<Pagina<StockRow>> {
    const validDays = diasDeVigencia();
    const corte = new Date(ahora.getTime() - validDays * 24 * 60 * 60 * 1000);
    const lista: Array<[string, unknown]> = [
      ['tienda_id = ?', filtros.storeId],
      ['presentacion_id = ?', filtros.presentationId],
    ];
    if (filtros.status === 'vencido') lista.push(['actualizado_en < ?', corte]);
    if (filtros.status === 'disponible') lista.push(['actualizado_en >= ? AND stock_disponible > 0', corte]);
    if (filtros.status === 'agotado') lista.push(['actualizado_en >= ? AND stock_disponible = 0', corte]);
    const { donde, valores } = condiciones(lista);
    const { page, limit, offset } = limites(filtros);
    const [filas, [{ total }]] = await Promise.all([
      this.dataSource.query(
        `SELECT tienda_id, presentacion_id, stock_disponible, actualizado_en FROM inventario ${donde}
         ORDER BY actualizado_en DESC, id DESC LIMIT $${valores.length + 1} OFFSET $${valores.length + 2}`,
        [...valores, limit, offset],
      ),
      this.dataSource.query(`SELECT COUNT(*)::int AS total FROM inventario ${donde}`, valores),
    ]);
    const data = (filas as Fila[]).map((f) => ({
      storeId: f.tienda_id,
      presentationId: f.presentacion_id,
      stock: Number(f.stock_disponible),
      capturedAt: f.actualizado_en,
      ageDays: edadEnDias(f.actualizado_en, ahora),
      status: estadoExistencia(Number(f.stock_disponible), f.actualizado_en, ahora, validDays),
    }));
    return armarPagina(data, total, page, limit);
  }
}

/** Arma el `WHERE` con las condiciones cuyo valor viene definido (`?` → `$n`). */
function condiciones(lista: Array<[string, unknown]>): { donde: string; valores: unknown[] } {
  const partes: string[] = [];
  const valores: unknown[] = [];
  for (const [sql, valor] of lista) {
    if (valor === undefined) continue;
    valores.push(valor);
    partes.push(sql.replace('?', `$${valores.length}`));
  }
  return { donde: partes.length ? `WHERE ${partes.join(' AND ')}` : '', valores };
}
