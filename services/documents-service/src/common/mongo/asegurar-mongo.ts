import { Logger } from '@nestjs/common';
import { Connection } from 'mongoose';

/**
 * Conexión a MongoDB que NO tumba el servicio (D-25).
 *
 * `MongooseModule` se registra con `lazyConnection: true`: el arranque no espera a Mongo, así que
 * con Mongo caído (o sin `MONGO_URL`) el servicio arranca igual y solo las rutas que lo usan
 * responden 503. Si la primera conexión falló, Mongoose no reintenta solo: esta función vuelve a
 * abrirla bajo demanda (una sola vez a la vez) antes de cada operación y en el health. Una vez
 * conectado, el driver se encarga de las reconexiones.
 */
const ESTADO_CONECTADO = 1;
const ESTADO_CONECTANDO = 2;
const ESPERA_MS = 2500;

let enCurso: Promise<unknown> | null = null;

export function uriMongo(): string {
  return process.env.MONGO_URL ?? 'mongodb://localhost:27017/retaildb';
}

export const OPCIONES_MONGO = { serverSelectionTimeoutMS: 2000, bufferCommands: false } as const;

const logger = new Logger('MongoDB');

/**
 * `connectionFactory` del MongooseModule. Con `lazyConnection` nadie espera la primera conexión: si
 * falla y la conexión no tiene listener de `error`, su promesa queda sin manejar y Node TUMBA el
 * proceso. Con el listener Mongoose la atrapa y el fallo solo se registra.
 */
export function conexionTolerante(conexion: Connection): Connection {
  conexion.on('error', (error: Error) => logger.warn(`Sin conexión a MongoDB: ${error.message}`));
  return conexion;
}

/** `true` si hay conexión utilizable; nunca lanza. */
export async function asegurarMongo(conexion: Connection): Promise<boolean> {
  if (conexion.readyState === ESTADO_CONECTADO) return true;
  if (!enCurso) {
    // Dentro de una promesa: un fallo síncrono también queda atrapado.
    const intento = Promise.resolve().then(() =>
      conexion.readyState === ESTADO_CONECTANDO ? conexion.asPromise() : conexion.openUri(uriMongo(), OPCIONES_MONGO),
    );
    enCurso = Promise.race([intento, new Promise((r) => setTimeout(r, ESPERA_MS))])
      .catch(() => undefined)
      .finally(() => {
        enCurso = null;
      });
  }
  await enCurso;
  // Se relee: el intento de arriba pudo cambiarlo (TS lo daría por imposible si no).
  return (conexion.readyState as number) === ESTADO_CONECTADO;
}
