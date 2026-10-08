import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { Logger } from '@nestjs/common';
import { AuditReporter } from './audit-reporter.service';

/**
 * Paso 8 del flujo de importación: el evento se reporta a audit-service y
 * NUNCA bloquea la operación que lo origina. Se prueba contra servidores
 * HTTP locales de verdad, porque lo que importa es justo el comportamiento
 * de red (no-2xx, cuelgue, puerto cerrado).
 */
const EVENTO = {
  tabla: 'importaciones',
  registroId: 'imp1',
  accion: 'importacion' as const,
  descripcion: 'Importación CSV confirmada.',
  ip: '1.2.3.4',
};
const TOKEN = 'token-de-prueba';

function levantar(manejador: Parameters<typeof createServer>[1]): Promise<Server> {
  const servidor = createServer(manejador);
  return new Promise((resolver) => servidor.listen(0, '127.0.0.1', () => resolver(servidor)));
}

const urlDe = (servidor: Server) => `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
const cerrar = (servidor: Server) => new Promise((r) => servidor.close(() => r(null)));

describe('AuditReporter (paso 8, best-effort)', () => {
  const original = process.env.AUDIT_SERVICE_URL;
  let avisos: string[];

  beforeEach(() => {
    avisos = [];
    jest.spyOn(Logger.prototype, 'warn').mockImplementation((mensaje: unknown) => {
      avisos.push(String(mensaje));
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (original === undefined) delete process.env.AUDIT_SERVICE_URL;
    else process.env.AUDIT_SERVICE_URL = original;
  });

  it('manda el evento completo a POST /v1/auditoria, con servicio y el Authorization del usuario', async () => {
    let recibido: Record<string, unknown> | null = null;
    let ruta = '';
    let authRecibido: string | undefined;
    const servidor = await levantar((req, res) => {
      ruta = req.url ?? '';
      authRecibido = req.headers.authorization;
      let cuerpo = '';
      req.on('data', (c) => (cuerpo += c));
      req.on('end', () => {
        recibido = JSON.parse(cuerpo);
        res.writeHead(201).end('{}');
      });
    });
    process.env.AUDIT_SERVICE_URL = urlDe(servidor);

    await new AuditReporter().reportar(EVENTO, `Bearer ${TOKEN}`);
    await cerrar(servidor);

    expect(ruta).toBe('/v1/auditoria');
    expect(recibido).toMatchObject({
      tabla: 'importaciones',
      accion: 'importacion',
      servicio: 'core-process-service',
      ip: '1.2.3.4',
    });
    expect(recibido).not.toHaveProperty('usuarioId');
    expect(recibido).not.toHaveProperty('rolId');
    expect(authRecibido).toBe(`Bearer ${TOKEN}`);
    expect(avisos).toHaveLength(0);
  });

  it('agrega "Bearer " si el token llega sin prefijo', async () => {
    let authRecibido: string | undefined;
    const servidor = await levantar((req, res) => {
      authRecibido = req.headers.authorization;
      res.writeHead(201).end('{}');
    });
    process.env.AUDIT_SERVICE_URL = urlDe(servidor);

    await new AuditReporter().reportar(EVENTO, TOKEN);
    await cerrar(servidor);

    expect(authRecibido).toBe(`Bearer ${TOKEN}`);
  });

  it('sin token no manda Authorization (no rompe la operación que reporta)', async () => {
    let authRecibido: string | undefined;
    const servidor = await levantar((req, res) => {
      authRecibido = req.headers.authorization;
      res.writeHead(201).end('{}');
    });
    process.env.AUDIT_SERVICE_URL = urlDe(servidor);

    await new AuditReporter().reportar(EVENTO);
    await cerrar(servidor);

    expect(authRecibido).toBeUndefined();
  });

  it('un no-2xx no rompe la operación, pero deja aviso en el log', async () => {
    // `fetch` no rechaza en 4xx/5xx: sin revisar `respuesta.ok` el evento
    // se perdía en absoluto silencio.
    const servidor = await levantar((_req, res) => {
      res.writeHead(400).end('{"message":"usuarioId debe ser un UUID v4"}');
    });
    process.env.AUDIT_SERVICE_URL = urlDe(servidor);

    await expect(new AuditReporter().reportar(EVENTO)).resolves.toBeUndefined();
    await cerrar(servidor);

    expect(avisos.join(' ')).toMatch(/Auditoría rechazada.*400/);
  });

  it('audit-service apagado: resuelve sin lanzar y lo registra', async () => {
    // Puerto cerrado: se levanta y se cierra para tener uno libre seguro.
    const servidor = await levantar((_req, res) => res.end());
    const url = urlDe(servidor);
    await cerrar(servidor);
    process.env.AUDIT_SERVICE_URL = url;

    await expect(new AuditReporter().reportar(EVENTO)).resolves.toBeUndefined();
    expect(avisos.join(' ')).toMatch(/Auditoría no reportada/);
  });

  it('audit-service colgado: corta por timeout y resuelve', async () => {
    // Acepta la conexión y nunca responde.
    const servidor = await levantar(() => {});
    process.env.AUDIT_SERVICE_URL = urlDe(servidor);

    const inicio = Date.now();
    await expect(new AuditReporter().reportar(EVENTO)).resolves.toBeUndefined();
    const transcurrido = Date.now() - inicio;

    servidor.closeAllConnections?.();
    await cerrar(servidor);

    expect(transcurrido).toBeLessThan(3000);
    expect(avisos.join(' ')).toMatch(/Auditoría no reportada/);
  }, 10000);

  it('sin AUDIT_SERVICE_URL avisa en el log en vez de callar', async () => {
    delete process.env.AUDIT_SERVICE_URL;
    await expect(new AuditReporter().reportar(EVENTO)).resolves.toBeUndefined();
    expect(avisos.join(' ')).toMatch(/falta AUDIT_SERVICE_URL/);
  });
});
