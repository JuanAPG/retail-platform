import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { Logger } from '@nestjs/common';
import { NotificationsReporter } from './notifications-reporter.service';

/**
 * Los avisos a notifications-service NUNCA bloquean ni rompen la operación que los origina. Igual que con la
 * auditoría, se prueba contra servidores HTTP locales de verdad: lo que importa es el comportamiento de red.
 */
const EVENTO = {
  eventType: 'precio.umbral' as const,
  relatedEntityType: 'precio',
  relatedEntityId: 'p-1',
  title: 'Cambio de precio',
  message: 'subió de 100.00 a 120.00',
};

function levantar(manejador: Parameters<typeof createServer>[1]): Promise<Server> {
  const servidor = createServer(manejador);
  return new Promise((resolver) => servidor.listen(0, '127.0.0.1', () => resolver(servidor)));
}
const urlDe = (s: Server) => `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
const cerrar = (s: Server) => new Promise((r) => s.close(() => r(null)));

// Servidores HTTP reales y un fetch en frío: con todas las suites en paralelo el límite de 5 s por defecto es justo.
jest.setTimeout(20000);

describe('NotificationsReporter de pricing-service (best-effort)', () => {
  const original = process.env.NOTIFICATIONS_SERVICE_URL;
  let avisos: string[];

  beforeEach(() => {
    avisos = [];
    jest.spyOn(Logger.prototype, 'warn').mockImplementation((m: unknown) => {
      avisos.push(String(m));
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (original === undefined) delete process.env.NOTIFICATIONS_SERVICE_URL;
    else process.env.NOTIFICATIONS_SERVICE_URL = original;
  });

  it('manda el evento con el servicio emisor, la prioridad por omisión y el Authorization de quien lo originó', async () => {
    let cuerpo: Record<string, unknown> | null = null;
    let auth: string | undefined;
    let ruta: string | undefined;
    const servidor = await levantar((req, res) => {
      auth = req.headers.authorization;
      ruta = req.url;
      let datos = '';
      req.on('data', (c) => (datos += c));
      req.on('end', () => {
        cuerpo = JSON.parse(datos);
        res.statusCode = 201;
        res.end('{}');
      });
    });
    process.env.NOTIFICATIONS_SERVICE_URL = urlDe(servidor);

    await new NotificationsReporter().emitir(EVENTO, 'tok');
    await cerrar(servidor);

    expect(ruta).toBe('/v1/notifications');
    expect(auth).toBe('Bearer tok');
    expect(cuerpo).toMatchObject({ ...EVENTO, sourceService: 'pricing-service', priority: 'info' });
  });

  it('respeta la prioridad y el destinatario que manda el emisor', async () => {
    let cuerpo: Record<string, unknown> | null = null;
    const servidor = await levantar((req, res) => {
      let datos = '';
      req.on('data', (c) => (datos += c));
      req.on('end', () => {
        cuerpo = JSON.parse(datos);
        res.end('{}');
      });
    });
    process.env.NOTIFICATIONS_SERVICE_URL = urlDe(servidor);

    await new NotificationsReporter().emitir({ ...EVENTO, priority: 'critical', recipientUserId: 'u-9' }, 'Bearer ya-con-prefijo');
    await cerrar(servidor);

    expect(cuerpo).toMatchObject({ priority: 'critical', recipientUserId: 'u-9' });
  });

  it('un token que ya trae "Bearer" no se duplica', async () => {
    let auth: string | undefined;
    const servidor = await levantar((req, res) => {
      auth = req.headers.authorization;
      res.end('{}');
    });
    process.env.NOTIFICATIONS_SERVICE_URL = urlDe(servidor);

    await new NotificationsReporter().emitir(EVENTO, 'Bearer abc');
    await cerrar(servidor);

    expect(auth).toBe('Bearer abc');
  });

  it('sin NOTIFICATIONS_SERVICE_URL no hace nada ni lanza', async () => {
    delete process.env.NOTIFICATIONS_SERVICE_URL;
    await expect(new NotificationsReporter().emitir(EVENTO)).resolves.toBeUndefined();
    expect(avisos).toEqual([]);
  });

  it('si el receptor rechaza (4xx/5xx) lo deja en el log y la operación sigue', async () => {
    const servidor = await levantar((_req, res) => {
      res.statusCode = 403;
      res.end('{}');
    });
    process.env.NOTIFICATIONS_SERVICE_URL = urlDe(servidor);

    await expect(new NotificationsReporter().emitir(EVENTO, 't')).resolves.toBeUndefined();
    await cerrar(servidor);

    expect(avisos.join(' ')).toMatch(/precio\.umbral.*HTTP 403/);
  });

  it('con el puerto cerrado se traga el error y lo registra', async () => {
    const servidor = await levantar((_req, res) => res.end());
    const url = urlDe(servidor);
    await cerrar(servidor);
    process.env.NOTIFICATIONS_SERVICE_URL = url;

    await expect(new NotificationsReporter().emitir(EVENTO, 't')).resolves.toBeUndefined();
    expect(avisos.join(' ')).toMatch(/no enviada/i);
  });

  it('con un servicio que acepta y calla, corta a ~1.5 s y no cuelga la operación', async () => {
    const colgados: Array<() => void> = [];
    const servidor = await levantar((_req, res) => {
      colgados.push(() => res.end());
    });
    process.env.NOTIFICATIONS_SERVICE_URL = urlDe(servidor);

    const inicio = Date.now();
    await new NotificationsReporter().emitir(EVENTO, 't');
    const tardo = Date.now() - inicio;
    colgados.forEach((c) => c());
    servidor.closeAllConnections();
    await cerrar(servidor);

    expect(tardo).toBeGreaterThanOrEqual(1400);
    expect(tardo).toBeLessThan(2500);
    expect(avisos.join(' ')).toMatch(/no enviada/i);
  }, 10000);
});
