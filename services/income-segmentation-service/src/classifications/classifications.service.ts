import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { Pagina } from '../common/dto/pagination.dto';
import { armarPagina, limites } from '../common/dto/pagina.dto';
import { ServiciosExternos } from '../common/http/servicios-externos.service';
import { ClassificationFilterDto } from './dto/classification.dto';

/** Clasificación de una zona. El orden de los campos es el del XSD. */
export interface ZoneClassification {
  id: string;
  zoneId: string;
  segmentId: number;
  segmentCode: string;
  /** Nombre del segmento EN LA VERSIÓN con la que se clasificó. */
  segmentName: string;
  segmentVersion: number;
  segmentCurrentVersion: number;
  origin: 'manual' | 'cluster';
  validFrom: string;
  validTo: string | null;
  current: boolean;
  assignedBy: string | null;
}

type Fila = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * El segmento llega por asignación manual o, en registros anteriores, por el
 * cluster de una corrida (`corrida_clusters` es parte del modelo de
 * clasificación que se recibe con D-35). El nombre sale de la versión con la
 * que se clasificó; si esa versión no existe (dato previo al versionado), del
 * segmento vigente.
 */
const SELECT_CLASIFICACION = `
  SELECT zc.id, zc.zona_id, s.id AS segmento_id, s.codigo,
         COALESCE(sv.nombre, s.nombre) AS nombre,
         zc.segmento_version, s.version_actual,
         CASE WHEN zc.segmento_manual_id IS NOT NULL THEN 'manual' ELSE 'cluster' END AS origen,
         to_char(zc.vigente_desde, 'YYYY-MM-DD') AS desde,
         to_char(zc.vigente_hasta, 'YYYY-MM-DD') AS hasta,
         zc.vigente, zc.asignada_por
  FROM zona_clasificaciones zc
  LEFT JOIN corrida_clusters cc
         ON cc.corrida_id = zc.corrida_id AND cc.cluster_valor = zc.cluster_valor
  JOIN segmentos_ingreso s ON s.id = COALESCE(zc.segmento_manual_id, cc.segmento_ingreso_id)
  LEFT JOIN segmento_versiones sv ON sv.segmento_id = s.id AND sv.version = zc.segmento_version`;

function aClasificacion(f: Fila): ZoneClassification {
  return {
    id: f.id,
    zoneId: f.zona_id,
    segmentId: Number(f.segmento_id),
    segmentCode: f.codigo,
    segmentName: f.nombre,
    segmentVersion: Number(f.segmento_version),
    segmentCurrentVersion: Number(f.version_actual),
    origin: f.origen,
    validFrom: f.desde,
    validTo: f.hasta,
    current: f.vigente,
    assignedBy: f.asignada_por,
  };
}

/** `2026-02-30` pasa el formato pero no existe: Postgres respondería error, no vacío. */
function esFechaReal(texto: string): boolean {
  const fecha = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === texto;
}

/**
 * Clasificación de zonas (D-35). Cada zona tiene UNA clasificación vigente y
 * un historial; cada clasificación guarda el segmento y la versión con la que
 * se hizo, así un análisis de un periodo pasado usa la que valía entonces.
 * El segmento es de la ZONA agregada, nunca de una persona (RN-02).
 */
@Injectable()
export class ClassificationsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly externos: ServiciosExternos,
  ) {}

  async findAll(filtros: ClassificationFilterDto): Promise<Pagina<ZoneClassification>> {
    if (filtros.asOf !== undefined && filtros.current !== undefined) {
      throw new BadRequestException('asOf y current no se combinan: usa uno de los dos.');
    }
    if (filtros.asOf !== undefined && !esFechaReal(filtros.asOf)) {
      throw new BadRequestException('asOf no es una fecha válida.');
    }
    const condiciones: string[] = [];
    const valores: unknown[] = [];
    const agregar = (sql: string, valor: unknown) => {
      valores.push(valor);
      condiciones.push(sql.replace('?', `$${valores.length}`));
    };
    if (filtros.zoneId) agregar('zc.zona_id = ?', filtros.zoneId);
    if (filtros.segmentId) agregar('s.id = ?', filtros.segmentId);
    if (filtros.current !== undefined) condiciones.push(filtros.current ? 'zc.vigente' : 'NOT zc.vigente');
    if (filtros.asOf) {
      valores.push(filtros.asOf);
      const n = `$${valores.length}::date`;
      condiciones.push(`zc.vigente_desde <= ${n} AND (zc.vigente_hasta IS NULL OR zc.vigente_hasta > ${n})`);
    }
    const donde = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
    return this.paginar(donde, valores, filtros);
  }

  /** La clasificación vigente de la zona; sin ella → 404. */
  async current(zoneId: string, manager: EntityManager = this.dataSource.manager): Promise<ZoneClassification> {
    const [fila] = await manager.query(`${SELECT_CLASIFICACION} WHERE zc.zona_id = $1 AND zc.vigente`, [zoneId]);
    if (!fila) throw new NotFoundException(`La zona ${zoneId} no tiene clasificación vigente.`);
    return aClasificacion(fila);
  }

  /** Todas las vigentes (una por zona clasificada), sin paginar: la usa la regla de publicación. */
  async vigentes(zoneId?: string): Promise<ZoneClassification[]> {
    const filas: Fila[] = await this.dataSource.query(
      `${SELECT_CLASIFICACION} WHERE zc.vigente ${zoneId ? 'AND zc.zona_id = $1' : ''} ORDER BY zc.zona_id`,
      zoneId ? [zoneId] : [],
    );
    return filas.map(aClasificacion);
  }

  history(zoneId: string, filtros: { page?: number; limit?: number }): Promise<Pagina<ZoneClassification>> {
    return this.paginar('WHERE zc.zona_id = $1', [zoneId], filtros);
  }

  /**
   * Clasifica la zona a mano. Cierra la vigente (no se borra: es el
   * historial) y crea la nueva con la versión VIGENTE del segmento. Si ya
   * está en ese segmento y en esa versión, no cambia nada (`cambio: false`).
   */
  async classify(
    zoneId: string,
    segmentId: number,
    usuarioId: string,
    token: string | undefined,
  ): Promise<{ classification: ZoneClassification; previa: ZoneClassification | null; cambio: boolean }> {
    await this.exigirZona(zoneId, token);
    try {
      return await this.dataSource.transaction(async (manager) => {
        // El bloqueo evita que el segmento cambie de versión a media clasificación.
        const [segmento] = await manager.query(
          'SELECT id, version_actual FROM segmentos_ingreso WHERE id = $1 FOR SHARE',
          [segmentId],
        );
        if (!segmento) throw new BadRequestException(`No existe el segmento de ingreso ${segmentId}.`);

        const [filaPrevia] = await manager.query(
          `${SELECT_CLASIFICACION} WHERE zc.zona_id = $1 AND zc.vigente FOR UPDATE OF zc`,
          [zoneId],
        );
        const previa = filaPrevia ? aClasificacion(filaPrevia) : null;
        if (
          previa &&
          previa.origin === 'manual' &&
          previa.segmentId === segmentId &&
          previa.segmentVersion === Number(segmento.version_actual)
        ) {
          return { classification: previa, previa, cambio: false };
        }

        await manager.query(
          'UPDATE zona_clasificaciones SET vigente_hasta = CURRENT_DATE WHERE zona_id = $1 AND vigente_hasta IS NULL',
          [zoneId],
        );
        await manager.query(
          `INSERT INTO zona_clasificaciones (zona_id, segmento_manual_id, segmento_version, asignada_por)
           VALUES ($1, $2, $3, $4)`,
          [zoneId, segmentId, segmento.version_actual, usuarioId],
        );
        return { classification: await this.current(zoneId, manager), previa, cambio: true };
      });
    } catch (error) {
      const codigo = error instanceof QueryFailedError ? (error as unknown as { code?: string }).code : undefined;
      // 23505: otra petición clasificó la misma zona en el mismo instante (una sola vigente por zona).
      if (codigo === '23505') {
        throw new ConflictException('La zona se clasificó al mismo tiempo desde otra sesión. Vuelve a intentarlo.');
      }
      throw error;
    }
  }

  /**
   * La zona es de catalog-service: se valida por HTTP, no leyendo su tabla.
   * 404 allá → 404 aquí; si catalog no responde → 503.
   */
  private async exigirZona(zoneId: string, token: string | undefined): Promise<void> {
    const base = process.env.CATALOG_SERVICE_URL ?? 'http://catalog-service:3102';
    const { status } = await this.externos.obtener('catalog-service', `${base}/v1/zones/${zoneId}`, token);
    if (status === 404) throw new NotFoundException(`No existe la zona ${zoneId}.`);
    if (status !== 200) {
      throw new ServiceUnavailableException(`catalog-service no confirmó la zona ${zoneId} (estado ${status}).`);
    }
  }

  private async paginar(
    donde: string,
    valores: unknown[],
    filtros: { page?: number; limit?: number },
  ): Promise<Pagina<ZoneClassification>> {
    const { page, limit, offset } = limites(filtros);
    const [filas, [{ total }]] = await Promise.all([
      this.dataSource.query(
        `${SELECT_CLASIFICACION} ${donde} ORDER BY zc.vigente_desde DESC, zc.created_at DESC
         LIMIT $${valores.length + 1} OFFSET $${valores.length + 2}`,
        [...valores, limit, offset],
      ),
      this.dataSource.query(
        `SELECT COUNT(*)::int AS total FROM (${SELECT_CLASIFICACION} ${donde}) AS c`,
        valores,
      ),
    ]);
    return armarPagina(filas.map(aClasificacion), total, page, limit);
  }
}
