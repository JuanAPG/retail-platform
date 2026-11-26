import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  Collection,
  Db,
  Filter,
  MongoClient,
  MongoNetworkError,
  MongoNotConnectedError,
  MongoOperationTimeoutError,
  MongoServerClosedError,
  MongoServerError,
  MongoServerSelectionError,
  MongoTopologyClosedError,
} from 'mongodb';
import { getRedis } from '../../common/auth/redis.client';
import { EstadoEntrega, ResultadoCaptura, Resumen, TipoCaptura } from '../tipos';
import { CapturaGuardada, FiltroLotes, LoteGuardado, RepositorioSync } from './puertos';

export const MONGO_CLIENT = Symbol('MONGO_CLIENT');

/** Colecciones del contrato §7 (D-47). */
export const COLECCION_LOTES = 'lotes_sync';
export const COLECCION_CAPTURAS = 'capturas_sync';

type DocLote = Omit<LoteGuardado, 'batchId'> & { _id: string };
type DocCaptura = Omit<CapturaGuardada, 'captureId'> & { _id: string };

/**
 * Cliente de MongoDB. Tiempos cortos a propósito: con Mongo caído o en pausa
 * la operación falla en segundos y responde 503 (D-25) en vez de quedarse
 * colgada. `socketTimeoutMS` cubre el caso de la conexión abierta que deja de
 * contestar (`timeoutMS` está obsoleto en el driver 6 y no tiene efecto).
 * El driver conecta en la primera operación: el servicio arranca aunque
 * Mongo no esté arriba.
 */
export function crearClienteMongo(): MongoClient {
  return new MongoClient(process.env.MONGO_URL ?? 'mongodb://localhost:27017', {
    serverSelectionTimeoutMS: 2000,
    connectTimeoutMS: 2000,
    socketTimeoutMS: 5000,
  });
}

/** Cierra Mongo y Redis al apagar (sin esto el proceso no termina en las pruebas ni en un `SIGTERM`). */
@Injectable()
export class CierreDeConexiones implements OnApplicationShutdown {
  constructor(@Inject(MONGO_CLIENT) private readonly cliente: MongoClient) {}

  async onApplicationShutdown(): Promise<void> {
    await this.cliente.close().catch(() => undefined);
    await getRedis().quit().catch(() => getRedis().disconnect());
  }
}

export function nombreBaseMongo(): string {
  return process.env.MONGO_DB ?? 'retaildb';
}

/** Errores del pool que no heredan de MongoNetworkError (se reconocen por nombre). */
const NOMBRES_DE_CAIDA = new Set(['MongoPoolClosedError', 'MongoWaitQueueTimeoutError']);

/**
 * ¿El error es "Mongo no responde"? Por CLASE, no por nombre: el driver lanza
 * p. ej. `PoolClearedOnNetworkError` (hereda de `MongoNetworkError` pero su
 * nombre no empieza con "Mongo"); con una lista de nombres salía 500.
 */
export function esCaida(error: unknown): boolean {
  return (
    error instanceof MongoNetworkError ||
    error instanceof MongoServerSelectionError ||
    error instanceof MongoNotConnectedError ||
    error instanceof MongoTopologyClosedError ||
    error instanceof MongoOperationTimeoutError ||
    error instanceof MongoServerClosedError ||
    (error instanceof Error && NOMBRES_DE_CAIDA.has(error.name))
  );
}

function esLlaveDuplicada(error: unknown): boolean {
  return error instanceof MongoServerError && error.code === 11000;
}

/**
 * Adaptador MongoDB de `RepositorioSync`. `_id` = `batchId` en `lotes_sync`
 * y `_id` = `captureId` en `capturas_sync` (la idempotencia durable).
 */
@Injectable()
export class MongoRepositorioSync implements RepositorioSync, OnModuleInit {
  private readonly logger = new Logger('mongo');
  private readonly db: Db;

  constructor(@Inject(MONGO_CLIENT) cliente: MongoClient) {
    this.db = cliente.db(nombreBaseMongo());
  }

  private get lotes(): Collection<DocLote> {
    return this.db.collection<DocLote>(COLECCION_LOTES);
  }

  private get capturas(): Collection<DocCaptura> {
    return this.db.collection<DocCaptura>(COLECCION_CAPTURAS);
  }

  /** Índices de §7. Si Mongo no está arriba al arrancar, se reintenta luego sin tumbar el servicio. */
  onModuleInit(): void {
    void this.asegurarIndices();
  }

  async asegurarIndices(intento = 1): Promise<void> {
    const retencion = parseInt(process.env.SYNC_RETENCION_DIAS ?? '365', 10) * 24 * 60 * 60;
    try {
      await Promise.all([
        this.lotes.createIndex({ userId: 1, receivedAt: -1 }),
        this.lotes.createIndex({ deviceId: 1, receivedAt: -1 }),
        // D-43: capturas de campo se retienen 1 año.
        this.lotes.createIndex({ receivedAt: 1 }, { expireAfterSeconds: retencion, name: 'ttl_retencion' }),
        this.capturas.createIndex({ type: 1, storeId: 1, presentationId: 1, capturedAt: -1 }),
        this.capturas.createIndex({ receivedAt: 1 }, { expireAfterSeconds: retencion, name: 'ttl_retencion' }),
      ]);
    } catch (error) {
      const espera = Math.min(30000, 1000 * 2 ** intento);
      this.logger.warn(`No se pudieron crear los índices (intento ${intento}): ${String(error)}. Reintento en ${espera} ms.`);
      setTimeout(() => void this.asegurarIndices(intento + 1), espera).unref();
    }
  }

  private async conMongo<T>(operacion: () => Promise<T>): Promise<T> {
    try {
      return await operacion();
    } catch (error) {
      if (esCaida(error)) {
        this.logger.error(`MongoDB no responde: ${(error as Error).message}`);
        throw new ServiceUnavailableException('No se pudo guardar el lote: MongoDB no responde. Reintenta más tarde.');
      }
      throw error;
    }
  }

  buscarLote(batchId: string): Promise<LoteGuardado | null> {
    return this.conMongo(async () => {
      const doc = await this.lotes.findOne({ _id: batchId });
      return doc ? aLote(doc) : null;
    });
  }

  crearLote(lote: LoteGuardado): Promise<boolean> {
    return this.conMongo(async () => {
      const { batchId, ...resto } = lote;
      try {
        await this.lotes.insertOne({ _id: batchId, ...resto });
        return true;
      } catch (error) {
        if (esLlaveDuplicada(error)) return false;
        throw error;
      }
    });
  }

  guardarResultados(batchId: string, resultados: ResultadoCaptura[], resumen: Resumen, estados: string[]): Promise<void> {
    return this.conMongo(async () => {
      await this.lotes.updateOne(
        { _id: batchId },
        { $set: { resultados, resumen, estados, estado: 'terminado', updatedAt: new Date() } },
      );
    });
  }

  marcarEntrega(batchId: string, canal: 'audit' | 'notification', estado: EstadoEntrega, error: string | null): Promise<void> {
    return this.conMongo(async () => {
      await this.lotes.updateOne(
        { _id: batchId },
        { $set: { [`delivery.${canal}`]: estado, [`delivery.${canal}Error`]: error, updatedAt: new Date() } },
      );
    });
  }

  buscarCapturas(ids: string[]): Promise<Map<string, CapturaGuardada>> {
    return this.conMongo(async () => {
      const mapa = new Map<string, CapturaGuardada>();
      if (ids.length === 0) return mapa;
      const docs = await this.capturas.find({ _id: { $in: ids } }).toArray();
      for (const doc of docs) mapa.set(doc._id, aCaptura(doc));
      return mapa;
    });
  }

  reservarCaptura(captura: CapturaGuardada): Promise<boolean> {
    return this.conMongo(async () => {
      const { captureId, ...resto } = captura;
      try {
        await this.capturas.insertOne({ _id: captureId, ...resto });
        return true;
      } catch (error) {
        if (esLlaveDuplicada(error)) return false;
        throw error;
      }
    });
  }

  guardarCaptura(captura: CapturaGuardada): Promise<void> {
    return this.conMongo(async () => {
      const { captureId, ...resto } = captura;
      await this.capturas.replaceOne({ _id: captureId }, resto, { upsert: true });
    });
  }

  ultimaAceptada(type: TipoCaptura, storeId: string, presentationId: string): Promise<Date | null> {
    return this.conMongo(async () => {
      const doc = await this.capturas.findOne(
        { type, storeId, presentationId, status: 'aceptada' },
        { sort: { capturedAt: -1 }, projection: { capturedAt: 1 } },
      );
      return doc ? doc.capturedAt : null;
    });
  }

  listarLotes(filtro: FiltroLotes, skip: number, limit: number): Promise<{ filas: LoteGuardado[]; total: number }> {
    return this.conMongo(async () => {
      const consulta: Filter<DocLote> = {};
      if (filtro.userId) consulta.userId = filtro.userId;
      if (filtro.deviceId) consulta.deviceId = filtro.deviceId;
      if (filtro.status) consulta.estados = filtro.status;
      if (filtro.desde || filtro.hasta) {
        consulta.receivedAt = {
          ...(filtro.desde ? { $gte: filtro.desde } : {}),
          ...(filtro.hasta ? { $lt: filtro.hasta } : {}),
        };
      }
      const [docs, total] = await Promise.all([
        this.lotes.find(consulta).sort({ receivedAt: -1, _id: 1 }).skip(skip).limit(limit).toArray(),
        this.lotes.countDocuments(consulta),
      ]);
      return { filas: docs.map(aLote), total };
    });
  }
}

function aLote(doc: DocLote): LoteGuardado {
  const { _id, ...resto } = doc;
  return { batchId: _id, ...resto };
}

function aCaptura(doc: DocCaptura): CapturaGuardada {
  const { _id, ...resto } = doc;
  return { captureId: _id, ...resto };
}
