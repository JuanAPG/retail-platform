import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { Paginable } from '../common/helpers/pagination.helper';
import { CorridaAsociacionDocument, CorridaAsociacionMongo } from './corrida-asociacion.schema';

/** Lo que se guarda: el documento sin `_id` (lo genera el esquema) ni `type`. */
export type NuevaCorrida = Omit<CorridaAsociacionMongo, '_id' | 'type' | 'date'>;

const NO_DISPONIBLE = 'Las corridas de asociación (MongoDB) no están disponibles. Intenta más tarde.';

/**
 * Corridas de asociación en MongoDB (D3). Con Mongo caído responde 503 (D-25)
 * en vez de dejar la petición colgada o devolver 500: `bufferCommands: false`
 * en AppModule (mismo patrón que notifications-service), más `sinMongo`
 * para los errores del driver que llegan antes de que la conexión cambie de
 * estado (red caída a media operación, credenciales rechazadas).
 */
@Injectable()
export class CorridasAsociacion {
  constructor(
    @InjectModel(CorridaAsociacionMongo.name) private readonly modelo: Model<CorridaAsociacionDocument>,
    @InjectConnection() private readonly conexion: Connection,
  ) {}

  async guardar(corrida: NuevaCorrida): Promise<CorridaAsociacionMongo> {
    this.exigirMongo();
    const doc = await sinMongo(() => this.modelo.create({ ...corrida, type: 'asociacion', date: new Date() }));
    return doc.toObject();
  }

  /**
   * El historial para `paginar()`: de la más reciente a la más antigua (el
   * `_id` desempata dos corridas del mismo milisegundo). Sin reglas ni
   * supuestos: pueden ser cientos por corrida y se piden con `porId`.
   */
  historial(): Paginable<CorridaAsociacionMongo> {
    this.exigirMongo();
    const filtro = { type: 'asociacion' };
    const modelo = this.modelo;
    let saltar = 0;
    let limite = 0;
    const consulta: Paginable<CorridaAsociacionMongo> = {
      skip(n: number) {
        saltar = n;
        return this;
      },
      take(n: number) {
        limite = n;
        return this;
      },
      getManyAndCount: () =>
        sinMongo(() =>
          Promise.all([
            modelo
              .find(filtro, { results: 0, assumptions: 0, filters: 0, snapshot: 0 })
              .sort({ date: -1, _id: 1 })
              .skip(saltar)
              .limit(limite)
              .lean<CorridaAsociacionMongo[]>(),
            modelo.countDocuments(filtro),
          ]),
        ),
    };
    return consulta;
  }

  async porId(id: string): Promise<CorridaAsociacionMongo | null> {
    this.exigirMongo();
    return sinMongo(() => this.modelo.findOne({ _id: id, type: 'asociacion' }).lean<CorridaAsociacionMongo>().exec());
  }

  /** 503 si Mongo no está conectado. Se llama también antes de correr el algoritmo. */
  exigirMongo(): void {
    if (this.conexion.readyState !== 1) {
      throw new ServiceUnavailableException(NO_DISPONIBLE);
    }
  }
}

/**
 * Corre una operación de Mongo y convierte en 503 los errores de
 * disponibilidad del driver (`MongoNetworkError`, `MongoServerSelectionError`,
 * `MongoServerError` de autenticación, `MongooseServerSelectionError`…). Un
 * error de validación o de conversión (`ValidationError`, `CastError`) es un
 * bug y se deja pasar tal cual.
 */
export async function sinMongo<T>(operacion: () => Promise<T>): Promise<T> {
  try {
    return await operacion();
  } catch (error) {
    if (error instanceof Error && error.name.startsWith('Mongo')) {
      throw new ServiceUnavailableException(NO_DISPONIBLE);
    }
    throw error;
  }
}
