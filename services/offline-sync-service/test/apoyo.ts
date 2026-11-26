/**
 * Apoyo de la integración: la app real (mismo `configurarApp` que main.ts)
 * escuchando en un puerto libre, contra el Mongo y el Redis aislados de
 * `contenedores.ts`; sesiones reales en Redis; un servidor HTTP falso que
 * hace de audit-service y notifications-service; y validación XSD con Python
 * + lxml, independiente del validador que usa el servicio.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { execFileSync, spawnSync } from 'child_process';
import { randomUUID } from 'crypto';
import { createServer, IncomingHttpHeaders, Server } from 'http';
import Redis from 'ioredis';
import { sign } from 'jsonwebtoken';
import { AddressInfo } from 'net';
import { join } from 'path';
import { AppModule } from '../src/app.module';
import { configurarApp } from '../src/app.setup';

export const XSD = join(__dirname, '..', '..', '..', 'docs', 'contratos', 'offline-sync-service.xsd');
export const HEALTH_XSD = join(__dirname, '..', '..', '..', 'docs', 'contratos', 'health.xsd');
export const usaDocker = process.env.SYNC_IT_DOCKER !== '0';

export interface Sesion {
  token: string;
  id: string;
}

/** Token firmado + sesión activa en Redis (lo que verifica el SessionGuard). */
export async function sesion(redis: Redis, rol: string, conSesion = true): Promise<Sesion> {
  const id = randomUUID();
  if (conSesion) await redis.set(`session:${id}`, '1', 'EX', 900);
  const token = sign(
    { sub: id, email: `${id}@prueba.local`, rol, rolId: 0, jti: `it-${id}` },
    process.env.JWT_ACCESS_SECRET as string,
    { expiresIn: '15m' },
  );
  return { token, id };
}

export async function levantarApp(): Promise<{ app: INestApplication; base: string }> {
  const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
  // SYNC_IT_LOGS=1 muestra los logs de la app (útil para depurar una prueba).
  const app = modulo.createNestApplication({ bodyParser: false, logger: process.env.SYNC_IT_LOGS === '1' ? undefined : false });
  configurarApp(app);
  await app.listen(0);
  const { port } = app.getHttpServer().address() as AddressInfo;
  return { app, base: `http://127.0.0.1:${port}` };
}

export interface Respuesta {
  estado: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cuerpo: any;
  texto: string;
  tipo: string;
  correlacion: string | null;
}

export async function http(
  metodo: string,
  url: string,
  opciones: {
    token?: string;
    json?: unknown;
    xml?: string;
    cuerpo?: string;
    contentType?: string;
    accept?: string;
    correlacion?: string;
    signal?: AbortSignal;
  } = {},
): Promise<Respuesta> {
  const headers: Record<string, string> = {};
  if (opciones.token) headers.Authorization = `Bearer ${opciones.token}`;
  if (opciones.accept) headers.Accept = opciones.accept;
  if (opciones.correlacion) headers['X-Correlation-Id'] = opciones.correlacion;
  let body: string | undefined;
  if (opciones.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opciones.json);
  } else if (opciones.xml !== undefined) {
    headers['Content-Type'] = 'application/xml';
    body = opciones.xml;
  } else if (opciones.cuerpo !== undefined) {
    headers['Content-Type'] = opciones.contentType ?? 'text/plain';
    body = opciones.cuerpo;
  }
  const r = await fetch(url, { method: metodo, headers, body, signal: opciones.signal });
  const texto = await r.text();
  const tipo = r.headers.get('content-type') ?? '';
  return {
    estado: r.status,
    cuerpo: texto && tipo.includes('json') ? JSON.parse(texto) : null,
    texto,
    tipo,
    correlacion: r.headers.get('x-correlation-id'),
  };
}

/** `null` si valida contra el XSD (Python + lxml); si no, el motivo. */
export function errorDeXsd(xml: string, xsd = XSD): string | null {
  for (const python of ['python', 'python3']) {
    const corrida = spawnSync(python, [join(__dirname, 'validar_xsd.py'), xsd], { input: xml, encoding: 'utf8' });
    if (corrida.error || corrida.status === 3) continue;
    return corrida.status === 0 ? null : corrida.stdout.trim() || corrida.stderr.trim() || 'no valida';
  }
  throw new Error('Falta Python con lxml para validar el XML contra el XSD.');
}

/** Pausa / reanuda un contenedor aislado (simula Mongo o Redis caído). */
export function pausar(nombre: string): void {
  execFileSync('docker', ['pause', nombre], { stdio: 'ignore' });
}
export function reanudar(nombre: string): void {
  execFileSync('docker', ['unpause', nombre], { stdio: 'ignore' });
}

export interface PeticionRecibida {
  ruta: string;
  headers: IncomingHttpHeaders;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cuerpo: any;
}

/**
 * Servidor falso de audit-service (`/v1/auditoria`) y notifications-service
 * (`/v1/notifications`). Guarda lo que recibe y responde el estado que se le
 * indique (p. ej. 400, como hoy responden con un servicio fuera de su lista).
 */
export async function servidorFalso(estados: Record<string, number>): Promise<{
  url: string;
  recibidas: PeticionRecibida[];
  cerrar: () => Promise<void>;
}> {
  const recibidas: PeticionRecibida[] = [];
  const servidor: Server = createServer((req, res) => {
    let datos = '';
    req.on('data', (d) => (datos += d));
    req.on('end', () => {
      recibidas.push({ ruta: req.url ?? '', headers: req.headers, cuerpo: datos ? JSON.parse(datos) : null });
      const estado = estados[req.url ?? ''] ?? 201;
      res.writeHead(estado, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(estado < 400 ? { id: '1' } : { statusCode: estado, message: 'rechazado por el falso' }));
    });
  });
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', () => r()));
  const { port } = servidor.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    recibidas,
    cerrar: () => new Promise((r) => servidor.close(() => r())),
  };
}

export async function esperarHasta(condicion: () => Promise<boolean> | boolean, ms = 10000): Promise<void> {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    if (await condicion()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('La condición no se cumplió a tiempo.');
}
