import { Injectable, Logger, OnApplicationShutdown, ServiceUnavailableException } from '@nestjs/common';
import { Collection, MongoClient } from 'mongodb';
import { getRedis } from '../common/auth/redis.client';
import { Pagina } from '../common/dto/pagination.dto';
import { ServiceCheck } from './probe';
import { ServiceName } from './targets';

const LAST_KEY = 'monitoring:last';
const HISTORY_SECONDS = 86400;

@Injectable()
export class MonitoringStore implements OnApplicationShutdown {
  private readonly logger = new Logger(MonitoringStore.name);
  private readonly mongo = new MongoClient(
    process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017/retaildb',
    { serverSelectionTimeoutMS: 1500, socketTimeoutMS: 2000 },
  );
  private readonly collection: Collection<ServiceCheck> =
    this.mongo.db(process.env.MONGO_DB_NAME).collection('monitoreo_sondeos');
  private indexes: Promise<unknown> | undefined;

  async ping(): Promise<string> {
    try {
      await this.mongo.db().command({ ping: 1 });
      return 'ok';
    } catch {
      return 'error: MongoDB no responde';
    }
  }

  private since(): Date {
    return new Date(Date.now() - HISTORY_SECONDS * 1000);
  }

  async latest(): Promise<ServiceCheck[]> {
    try {
      const current = await getRedis().get(LAST_KEY);
      if (current) {
        const checks = JSON.parse(current) as ServiceCheck[];
        return checks.map((check) => ({ ...check, checkedAt: check.checkedAt && new Date(check.checkedAt) }));
      }
    } catch {
      this.logger.warn('No se pudo leer el último sondeo desde Redis.');
    }
    try {
      return await this.collection.aggregate<ServiceCheck>([
        { $match: { checkedAt: { $gte: this.since() } } },
        { $sort: { service: 1, checkedAt: -1, _id: -1 } },
        { $group: { _id: '$service', check: { $first: '$$ROOT' } } },
        { $replaceWith: '$check' },
        { $project: { _id: 0 } },
      ]).toArray();
    } catch {
      this.logger.warn('No se pudo recuperar el último sondeo desde MongoDB.');
      return [];
    }
  }

  async persist(checks: ServiceCheck[]): Promise<void> {
    const [mongo, redis] = await Promise.allSettled([
      this.persistHistory(checks),
      getRedis().set(LAST_KEY, JSON.stringify(checks), 'EX', HISTORY_SECONDS),
    ]);
    if (mongo.status === 'rejected') this.logger.error('No se pudo guardar el historial en MongoDB.');
    if (redis.status === 'rejected') this.logger.error('No se pudo guardar el último sondeo en Redis.');
  }

  private async persistHistory(checks: ServiceCheck[]): Promise<void> {
    this.indexes ??= this.collection.createIndexes([
      { key: { checkedAt: 1 }, expireAfterSeconds: HISTORY_SECONDS },
      { key: { service: 1, checkedAt: -1, _id: -1 } },
    ]).catch((error: unknown) => {
      this.indexes = undefined;
      throw error;
    });
    await this.indexes;
    await this.collection.insertMany(checks.map((check) => ({ ...check })));
  }

  async history(service: ServiceName, page: number, limit: number): Promise<Pagina<ServiceCheck>> {
    try {
      const filter = { service, checkedAt: { $gte: this.since() } };
      const total = await this.collection.countDocuments(filter);
      const offset = (page - 1) * limit;
      const data = offset < total
        ? await this.collection.find(filter, { projection: { _id: 0 } })
          .sort({ checkedAt: -1, _id: -1 }).skip(offset).limit(limit).toArray()
        : [];
      return { data, total, page, limit };
    } catch {
      throw new ServiceUnavailableException('No se pudo consultar el historial de sondeos.');
    }
  }

  onApplicationShutdown(): Promise<void> {
    return this.mongo.close();
  }
}
