import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { Logger } from '@nestjs/common';
import { AuditReporter } from './audit-reporter.service';

/**
 * El evento se reporta a audit-service y NUNCA bloquea la operación de
 * algorithms-core que lo origina (una corrida). Se prueba contra
 * servidores HTTP locales de verdad, porque lo que importa es justo el
 * comportamiento de red (cuelgue, puerto cerrado, sin configurar).
 */
const EVENTO = {
  tabla: 'analisis_corridas',
  registroId: 'r1',
  accion: 'ejecutar_corrida' as const,
  descripcion: 'Elasticidad completada.',
  ip: '1.2.3.4',
};
const TOKEN = 'token-de-prueba';

function levantar(manejador: Parameters<typeof createServer>[1]): Promise<Server> {
  const servidor = createServer(manejador);
  return new Promise((resolver) => servidor.listen(0, '127.0.0.1', () => resolver(servidor)));
}

const urlDe = (servidor: Server) => `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
const cerrar = (servidor: Server) => new Promise((r) => servidor.close(() => r(null)));

describe('AuditReporter de algorithms-core (best-effort)', () => {
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

  it('manda el evento con servicio y el Authorization del usuario, sin usuarioId/rolId en el cuerpo', async () => {
    let recibido: Record<string, unknown> | null = null;
    let authRecibido: string | undefined;
    const servidor = await levantar((req, res) => {
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

    expect(recibido).toMatchObject({ tabla: 'analisis_corridas', accion: 'ejecutar_corrida', servicio: 'algorithms-core' });
    expect(recibido).not.toHaveProperty('usuarioId');
    expect(recibido).not.toHaveProperty('rolId');
    expect(authRecibido).toBe(`Bearer ${TOKEN}`);
  });

  it('si audit-service rechaza el evento (4xx), lo deja en el log y no lanza', async () => {
    const servidor = await levantar((_req, res) => {
      res.statusCode = 400;
      res.end('{}');
    });
    process.env.AUDIT_SERVICE_URL = urlDe(servidor);

    await expect(new AuditReporter().reportar(EVENTO, 't')).resolves.toBeUndefined();
    await cerrar(servidor);

    expect(avisos.join(' ')).toMatch(/analisis_corridas:ejecutar_corrida.*HTTP 400/);
  });

  it('con audit-service apagado, la corrida igual responde: resuelve sin lanzar', async () => {
    // Puerto cerrado: se levanta y se cierra para tener uno libre seguro.
    const servidor = await levantar((_req, res) => res.end());
    const url = urlDe(servidor);
    await cerrar(servidor);
    process.env.AUDIT_SERVICE_URL = url;

    await expect(new AuditReporter().reportar(EVENTO, `Bearer ${TOKEN}`)).resolves.toBeUndefined();
    expect(avisos.join(' ')).toMatch(/Auditoría no reportada/);
  });

  it('audit-service colgado: corta por timeout y resuelve sin bloquear', async () => {
    const servidor = await levantar(() => {});
    process.env.AUDIT_SERVICE_URL = urlDe(servidor);

    const inicio = Date.now();
    await expect(new AuditReporter().reportar(EVENTO)).resolves.toBeUndefined();
    const transcurrido = Date.now() - inicio;

    servidor.closeAllConnections?.();
    await cerrar(servidor);

    expect(transcurrido).toBeLessThan(3000);
  }, 10000);

  it('sin AUDIT_SERVICE_URL no hace nada y no lanza', async () => {
    delete process.env.AUDIT_SERVICE_URL;
    await expect(new AuditReporter().reportar(EVENTO)).resolves.toBeUndefined();
  });
});
