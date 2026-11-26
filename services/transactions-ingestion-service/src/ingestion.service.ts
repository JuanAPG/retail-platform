import { createHash, randomUUID } from 'node:crypto';
import { Storage } from '@google-cloud/storage';
import { ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy,
  PayloadTooLargeException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { ROL } from './common/roles';
import { SesionUsuario } from './common/auth/session.guard';
import { CatalogClient } from './common/catalog/catalog-client.service';
import { conCorrelacion, correlacionActual } from './common/correlation/correlacion';
import { maxBytes, readFile } from './files';
import { prepare, Sale } from './prepare';

export const states = ['vista_previa', 'confirmando', 'conciliacion', 'confirmado', 'descartado'] as const;
const baseSummary = `SELECT b.id, b.state, b.format, b.sha256, b.size_bytes AS "sizeBytes", b.created_at AS "createdAt",
  (SELECT jsonb_build_object(
    'valid', count(*) FILTER (WHERE coalesce(v.result,f.result) IN ('valida','insertada')),
    'repeated', count(*) FILTER (WHERE coalesce(v.result,f.result) = 'repetida'),
    'rejected', count(*) FILTER (WHERE coalesce(v.result,f.result) = 'rechazada'),
    'conflicts', count(*) FILTER (WHERE coalesce(v.result,f.result) = 'conflicto'),
    'inserted', (SELECT count(*) FROM ventas_en_lote i WHERE i.batch_id=b.id AND i.result='insertada'))
  FROM filas_ingesta_ventas f LEFT JOIN ventas_en_lote v USING(batch_id,sale_no) WHERE f.batch_id=b.id) AS counts
  FROM lotes_ingesta_ventas b`;
const visibility = '(b.owner_id = $1 OR $2::boolean)';

@Injectable()
export class IngestionService implements OnModuleDestroy {
  private readonly logger = new Logger(IngestionService.name);
  private readonly db = new Pool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    connectionTimeoutMillis: 2500 });
  private readonly storage = process.env.GCS_INGESTION_BUCKET
    ? new Storage({ retryOptions: { totalTimeout: 10, maxRetries: 1 } }).bucket(process.env.GCS_INGESTION_BUCKET)
    : undefined;

  constructor(private readonly catalog: CatalogClient) {
    this.db.on('error', () => this.logger.error('Se perdió una conexión con PostgreSQL.'));
  }

  onModuleDestroy() { return this.db.end(); }
  async ping() { return this.db.query('SELECT 1'); }
  async bucketHealth() {
    if (!this.storage) return 'no configurado';
    try { await this.storage.getMetadata(); return 'ok'; }
    catch { return 'error: almacenamiento privado no disponible'; }
  }

  async fromObject(key: string, generation: string, actor: SesionUsuario, token: string) {
    const prefix = (process.env.GCS_INGESTION_INCOMING_PREFIX ?? 'ingestion/incoming').replace(/\/+$/, '');
    const ownerPrefix = `${prefix}/${actor.id}/`;
    if (!key.startsWith(ownerPrefix) || key.slice(ownerPrefix.length).split('/').some((part) => !part || part === '..' || part === '.')) {
      throw new NotFoundException('El original no existe.');
    }
    if (!this.storage) throw new ServiceUnavailableException('El almacenamiento privado no está configurado.');
    const file = this.storage.file(key, { generation });
    let bytes: Buffer;
    let mime: string | undefined;
    try {
      const [meta] = await file.getMetadata();
      if (meta.metadata?.ownerId !== actor.id) throw new NotFoundException('El original no existe.');
      if (meta.contentEncoding && meta.contentEncoding !== 'identity') throw new UnprocessableEntityException('Carga el objeto sin compresión.');
      if (Number(meta.size) > maxBytes) throw new PayloadTooLargeException('El objeto excede el tamaño admitido.');
      mime = meta.contentType;
      [bytes] = await file.download({ decompress: false });
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof PayloadTooLargeException || error instanceof UnprocessableEntityException) throw error;
      if (String((error as { code?: number }).code) === '404') throw new NotFoundException('El original no existe.');
      throw new ServiceUnavailableException('No fue posible leer el original.');
    }
    return this.upload(bytes, key.split('/').pop()!, mime, actor, token, { key, generation });
  }

  async upload(bytes: Buffer, filename: string, mime: string | undefined, actor: SesionUsuario,
    token: string, object?: { key: string; generation: string }) {
    const { format, rows } = readFile(bytes, mime);
    const [stores, products] = await Promise.all([this.catalog.listarTiendas(token), this.catalog.listarProductos(token)]);
    const { staged, sales } = prepare(rows, stores, products);
    const id = randomUUID();
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (!object && this.storage) {
      const key = `ingestion/originals/${actor.id}/${id}`;
      const file = this.storage.file(key);
      try {
        await file.save(bytes, { resumable: false, preconditionOpts: { ifGenerationMatch: 0 },
          metadata: { contentType: { csv: 'text/csv', json: 'application/json', xml: 'application/xml' }[format],
            metadata: { ownerId: actor.id, sha256: hash } } });
        const [meta] = await file.getMetadata();
        if (!meta.generation) throw new Error('Generación ausente.');
        object = { key, generation: String(meta.generation) };
      } catch {
        throw new ServiceUnavailableException('No fue posible guardar el original.');
      }
    }
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO lotes_ingesta_ventas
        (id,owner_id,format,sha256,size_bytes,filename,object_key,generation,original) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, actor.id, format, hash, bytes.length, filename.slice(0, 255), object?.key, object?.generation, object ? null : bytes]);
      // Cada inserción tiene dos parámetros, incluso para 10.000 filas.
      await client.query(`INSERT INTO ventas_en_lote(batch_id,sale_no,payload)
        SELECT $1,sale_no,payload FROM jsonb_to_recordset($2) AS data(sale_no integer,payload jsonb)`, [id, JSON.stringify(sales)]);
      await client.query(`INSERT INTO filas_ingesta_ventas(batch_id,row_no,sale_no,result,code,message)
        SELECT $1,row_no,sale_no,result,code,message FROM jsonb_to_recordset($2)
        AS data(row_no integer,sale_no integer,result text,code text,message text)`, [id, JSON.stringify(staged)]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return this.detail(id, actor);
  }

  async detail(id: string, actor: SesionUsuario, client?: PoolClient) {
    const result = await (client ?? this.db).query(`${baseSummary} WHERE ${visibility} AND b.id=$3`,
      [actor.id, actor.rol === ROL.ADMINISTRADOR, id]);
    if (!result.rowCount) throw new NotFoundException('El lote no existe.');
    const { counts, ...batch } = result.rows[0];
    return { ...batch, counts: { valid: counts.valid, repeated: counts.repeated, rejected: counts.rejected,
      conflicts: counts.conflicts, inserted: counts.inserted } };
  }

  async list(actor: SesionUsuario, page: number, limit: number, state?: string) {
    const where = `WHERE ${visibility} AND ($3::text IS NULL OR b.state=$3)`;
    const values = [actor.id, actor.rol === ROL.ADMINISTRADOR, state];
    const count = await this.db.query(`SELECT count(*)::int AS total FROM lotes_ingesta_ventas b ${where}`, values);
    const data = await this.db.query(`${baseSummary} ${where} ORDER BY b.created_at DESC,b.id DESC LIMIT $4 OFFSET $5`,
      [...values, limit, Math.min((page - 1) * limit, Number.MAX_SAFE_INTEGER)]);
    return { data: data.rows.map(({ counts, ...batch }) => ({ ...batch, counts: {
      valid: counts.valid, repeated: counts.repeated, rejected: counts.rejected, conflicts: counts.conflicts, inserted: counts.inserted,
    } })), total: count.rows[0].total, page, limit };
  }

  async rows(id: string, actor: SesionUsuario, page: number, limit: number) {
    const summary = await this.detail(id, actor);
    const { valid, repeated, rejected, conflicts } = summary.counts;
    const data = await this.db.query(`SELECT f.row_no AS row,
      CASE WHEN v.result='insertada' THEN 'valida' ELSE coalesce(v.result,f.result) END AS status,
      coalesce(v.code,f.code) AS code, coalesce(v.message,f.message) AS message
      FROM filas_ingesta_ventas f LEFT JOIN ventas_en_lote v USING(batch_id,sale_no)
      WHERE f.batch_id=$1 ORDER BY f.row_no LIMIT $2 OFFSET $3`,
    [id, limit, Math.min((page - 1) * limit, Number.MAX_SAFE_INTEGER)]);
    return { data: data.rows, total: valid + repeated + rejected + conflicts, page, limit };
  }

  async discard(id: string, actor: SesionUsuario) {
    await this.detail(id, actor);
    const result = await this.db.query("UPDATE lotes_ingesta_ventas SET state='descartado' WHERE id=$1 AND state IN ('vista_previa','descartado')", [id]);
    if (!result.rowCount) throw new ConflictException('Solo se puede descartar antes de confirmar.');
    return this.detail(id, actor);
  }

  async confirm(id: string, actor: SesionUsuario, token: string) {
    const client = await this.db.connect();
    let locked = false;
    let destroy = false;
    try {
      const summary = await this.detail(id, actor, client);
      if (summary.state === 'confirmado' || summary.state === 'conciliacion') return summary;
      const lock = await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,3111)) AS locked', [id]);
      locked = lock.rows[0].locked;
      if (!locked) throw new ConflictException('El lote ya se está confirmando.');
      const started = await client.query(`UPDATE lotes_ingesta_ventas SET state='confirmando'
        WHERE id=$1 AND state IN ('vista_previa','confirmando')`, [id]);
      if (!started.rowCount) {
        const current = await this.detail(id, actor, client);
        if (current.state === 'confirmado' || current.state === 'conciliacion') return current;
        throw new ConflictException('El lote fue descartado.');
      }
      while (true) {
        const pending = await client.query<{ sale_no: number; payload: Sale }>(`SELECT sale_no,payload FROM ventas_en_lote
          WHERE batch_id=$1 AND result='valida' ORDER BY sale_no LIMIT 5`, [id]);
        if (!pending.rowCount) break;
        const outcomes = await Promise.allSettled(pending.rows.map(async (sale) => {
          const result = await this.sendSale(id, sale.payload, token);
          await client.query(`UPDATE ventas_en_lote SET result=$3,transaction_id=$4,code=$5,message=$6
            WHERE batch_id=$1 AND sale_no=$2`, [id, sale.sale_no, result.status, result.transactionId, result.code, result.message]);
        }));
        const failed = outcomes.find((result) => result.status === 'rejected');
        if (failed) throw failed.reason;
      }
      const summaryAfter = await this.detail(id, actor, client);
      await client.query('UPDATE lotes_ingesta_ventas SET state=$2 WHERE id=$1',
        [id, summaryAfter.counts.conflicts > 0 ? 'conciliacion' : 'confirmado']);
      this.notify(id, token);
      return this.detail(id, actor, client);
    } finally {
      if (locked) {
        try { await client.query('SELECT pg_advisory_unlock(hashtextextended($1,3111))', [id]); }
        catch { destroy = true; }
      }
      client.release(destroy);
    }
  }

  private async sendSale(batchId: string, sale: Sale, token: string): Promise<{
    status: string; transactionId?: string; code?: string; message?: string;
  }> {
    const base = process.env.CORE_PROCESS_SERVICE_URL ?? 'http://localhost:3104';
    try {
      const reply = await fetch(`${base}/v1/transactions/internal/imported-sales`, {
        method: 'POST', headers: conCorrelacion({ Authorization: token, 'Content-Type': 'application/json' }),
        body: JSON.stringify({ batchId, ...sale }), signal: AbortSignal.timeout(10000),
      });
      const body = await reply.json();
      if (reply.status === 409) return { status: 'conflicto', code: 'FOLIO_EN_CONFLICTO', message: 'La venta existente tiene contenido diferente.' };
      if ([400, 404, 422].includes(reply.status)) return { status: 'rechazada', code: 'VENTA_RECHAZADA', message: 'Core rechazó los datos de la venta.' };
      if (reply.ok && ['insertada', 'repetida'].includes(body.status) && typeof body.transactionId === 'string') return body;
    } catch {
      // La venta queda pendiente. Core arbitra el reintento incluso si ya confirmó.
    }
    throw new ServiceUnavailableException('Core no confirmó el acuse. Vuelve a intentar el lote.');
  }

  private notify(id: string, token: string) {
    const auth = conCorrelacion({ Authorization: token, 'Content-Type': 'application/json' });
    const exports = [
      [process.env.NOTIFICATIONS_SERVICE_URL, '/v1/notifications', { sourceService: 'transactions-ingestion-service',
        eventType: 'ingesta.confirmada', relatedEntityId: id, title: 'Ingesta finalizada', message: 'Consulta el resultado del lote.' }],
      [process.env.AUDIT_SERVICE_URL, '/v1/auditoria', { servicio: 'transactions-ingestion-service', tabla: 'lotes_ingesta_ventas',
        registroId: id, accion: 'importacion', descripcion: 'Lote de ventas finalizado.' }],
    ] as const;
    for (const [base, route, payload] of exports) {
      if (!base) continue;
      void fetch(base + route, { method: 'POST', headers: auth, body: JSON.stringify(payload), signal: AbortSignal.timeout(1500) })
        .then(async (response) => { await response.body?.cancel(); if (!response.ok) throw new Error(String(response.status)); })
        .catch(() => this.logger.warn(`No se entregó ${route} para ${id}, correlación ${correlacionActual()}.`));
    }
  }
}
