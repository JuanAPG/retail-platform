/**
 * Apoyo de las pruebas de integración: sesiones reales en Redis, acceso
 * directo a Postgres para preparar y limpiar, y validación del XML contra el
 * XSD del contrato.
 *
 * No depende de auth-service: firma el JWT con JWT_ACCESS_SECRET y abre la
 * sesión en Redis, que es lo que verifica el SessionGuard.
 */
import { spawnSync } from 'child_process';
import Redis from 'ioredis';
import { sign } from 'jsonwebtoken';
import { join } from 'path';
import { Client } from 'pg';

export const BASE = process.env.AVAILABILITY_BASE_URL ?? 'http://localhost:3114';
export const CATALOG = process.env.CATALOG_BASE_URL ?? 'http://localhost:3102';
const SECRET = process.env.JWT_ACCESS_SECRET ?? 'dev_access_secret_solo_para_local';
const XSD = join(__dirname, '..', '..', '..', 'docs', 'contratos', 'availability-service.xsd');

export const redis = new Redis({
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
});

export async function conDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    user: process.env.DB_USER ?? 'retail_user',
    password: process.env.DB_PASSWORD ?? 'retail_pass_2026',
    database: process.env.DB_NAME ?? 'retaildb',
  });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

/**
 * Token de un usuario SEMBRADO (por correo), con sesión activa en Redis. Se
 * usa un usuario real porque `capturado_por` es llave
 * foránea a `usuarios`. `NX`: no pisa una sesión que ya esté abierta.
 */
export async function sesion(email: string): Promise<{ token: string; id: string }> {
  const usuario = await conDb(async (db) => {
    const { rows } = await db.query(
      'SELECT u.id, u.rol_id, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.email = $1',
      [email],
    );
    return rows[0];
  });
  if (!usuario) throw new Error(`Falta el usuario sembrado ${email} (db/data_retail.sql).`);
  await redis.set(`session:${usuario.id}`, '1', 'EX', 900, 'NX');
  const token = sign(
    { sub: usuario.id, email, rol: usuario.rol, rolId: usuario.rol_id, jti: `it-disp-${usuario.id}-${Date.now()}` },
    SECRET,
    { expiresIn: '15m' },
  );
  return { token, id: usuario.id };
}

export async function http(metodo: string, url: string, token?: string, cuerpo?: object, accept?: string) {
  const respuesta = await fetch(url, {
    method: metodo,
    headers: {
      ...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(accept ? { Accept: accept } : {}),
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const texto = await respuesta.text();
  const esJson = (respuesta.headers.get('content-type') ?? '').includes('json');
  return {
    estado: respuesta.status,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cuerpo: (texto && esJson ? JSON.parse(texto) : null) as any,
    texto,
    correlacion: respuesta.headers.get('x-correlation-id'),
  };
}

/**
 * `null` si el XML valida contra el XSD del contrato; si no, el motivo.
 * Devuelve `'sin-validador'` cuando no hay Python con lxml en la máquina.
 */
export function errorDeXsd(xml: string): string | null {
  for (const python of ['python', 'python3']) {
    const corrida = spawnSync(python, [join(__dirname, 'validar_xsd.py'), XSD], { input: xml, encoding: 'utf8' });
    if (corrida.error || corrida.status === 3) continue;
    return corrida.status === 0 ? null : corrida.stdout.trim() || corrida.stderr.trim() || 'no valida';
  }
  return 'sin-validador';
}
