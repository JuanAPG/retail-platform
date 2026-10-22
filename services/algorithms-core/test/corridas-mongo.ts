import mongoose, { Connection } from 'mongoose';

/**
 * Acceso directo a las corridas de asociación en MongoDB (D3) para las
 * pruebas de integración: contarlas y borrar las que crea cada prueba.
 * Mismo `MONGO_URL` que el servicio; el default es el Mongo del compose
 * visto desde la máquina (puerto 27017 publicado).
 */
const MONGO_URL =
  process.env.MONGO_URL ?? 'mongodb://retail_admin:retail_pass_2026@localhost:27017/retaildb?authSource=admin';

export class CorridasMongo {
  private conexion: Connection | null = null;

  async abrir(): Promise<void> {
    this.conexion = await mongoose.createConnection(MONGO_URL, { serverSelectionTimeoutMS: 5000 }).asPromise();
  }

  async cerrar(): Promise<void> {
    await this.conexion?.close();
  }

  /** Corridas de asociación guardadas (las de clustering de analytics-stats no cuentan). */
  contar(): Promise<number> {
    return this.coleccion().countDocuments({ type: 'asociacion' });
  }

  async borrar(ids: Iterable<string>): Promise<void> {
    const lista = [...ids];
    if (lista.length > 0) await this.coleccion().deleteMany({ _id: { $in: lista } as never, type: 'asociacion' });
  }

  private coleccion() {
    if (!this.conexion) throw new Error('CorridasMongo: falta abrir() en beforeAll');
    return this.conexion.collection('analysis_runs');
  }
}
