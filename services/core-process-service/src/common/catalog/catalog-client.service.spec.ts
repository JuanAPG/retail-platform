import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { Logger } from '@nestjs/common';
import { CatalogClient } from './catalog-client.service';

function levantar(manejador: Parameters<typeof createServer>[1]): Promise<Server> {
  const servidor = createServer(manejador);
  return new Promise((resolver) => servidor.listen(0, '127.0.0.1', () => resolver(servidor)));
}

const urlDe = (servidor: Server) => `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
const cerrar = (servidor: Server) => new Promise((r) => servidor.close(() => r(null)));

function tiendas(desde: number, cuantas: number) {
  return Array.from({ length: cuantas }, (_, i) => ({
    id: `t${desde + i}`,
    nombre: `Tienda ${desde + i}`,
  }));
}

describe('CatalogClient', () => {
  const original = process.env.CATALOG_SERVICE_URL;
  let servidor: Server | null = null;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    if (servidor) await cerrar(servidor);
    servidor = null;
    if (original === undefined) delete process.env.CATALOG_SERVICE_URL;
    else process.env.CATALOG_SERVICE_URL = original;
  });

  it('pagina las tiendas hasta agotarlas', async () => {
    // El catálogo tope `limit` en 100: con una sola página, la tienda 101
    // se rechazaba como inexistente.
    const paginas: number[] = [];
    servidor = await levantar((req, res) => {
      const url = new URL(req.url ?? '', 'http://x');
      const page = Number(url.searchParams.get('page'));
      paginas.push(page);
      const data = page === 1 ? tiendas(1, 100) : page === 2 ? tiendas(101, 50) : [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data, total: 150 }));
    });
    process.env.CATALOG_SERVICE_URL = urlDe(servidor);

    const resultado = await new CatalogClient().listarTiendas();

    expect(resultado).toHaveLength(150);
    expect(resultado[149]).toMatchObject({ id: 't150' });
    expect(paginas).toEqual([1, 2]);
  });

  it('pagina los productos igual que las tiendas', async () => {
    servidor = await levantar((req, res) => {
      const page = Number(new URL(req.url ?? '', 'http://x').searchParams.get('page'));
      const data =
        page === 1
          ? [{ id: 'p1', sku: 'A', estatus: 'activo', presentaciones: [] }]
          : [{ id: 'p2', sku: 'B', estatus: 'activo', presentaciones: [] }];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data, total: 2 }));
    });
    process.env.CATALOG_SERVICE_URL = urlDe(servidor);

    await expect(new CatalogClient().listarProductos()).resolves.toHaveLength(2);
  });

  it('acepta un arreglo plano (catálogo declarado como excepción de paginación)', async () => {
    servidor = await levantar((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(tiendas(1, 3)));
    });
    process.env.CATALOG_SERVICE_URL = urlDe(servidor);

    await expect(new CatalogClient().listarTiendas()).resolves.toHaveLength(3);
  });

  it('propaga el Bearer y pide JSON explícitamente', async () => {
    let cabeceras: Record<string, string | string[] | undefined> = {};
    servidor = await levantar((req, res) => {
      cabeceras = req.headers;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [], total: 0 }));
    });
    process.env.CATALOG_SERVICE_URL = urlDe(servidor);

    // Se normaliza el prefijo: llegue con o sin "Bearer ".
    await new CatalogClient().listarTiendas('Bearer abc.def.ghi');
    expect(cabeceras.authorization).toBe('Bearer abc.def.ghi');
    expect(cabeceras.accept).toBe('application/json');

    await new CatalogClient().listarTiendas('abc.def.ghi');
    expect(cabeceras.authorization).toBe('Bearer abc.def.ghi');
  });

  it('401 y 403 del catálogo NO se disfrazan de 503', async () => {
    for (const [status, esperado] of [
      [401, 401],
      [403, 403],
    ] as const) {
      const s = await levantar((_req, res) => res.writeHead(status).end('{}'));
      process.env.CATALOG_SERVICE_URL = urlDe(s);
      await expect(new CatalogClient().listarTiendas()).rejects.toMatchObject({ status: esperado });
      await cerrar(s);
    }
  });

  it('500 del catálogo se traduce a 503 "Catálogo no disponible."', async () => {
    servidor = await levantar((_req, res) => res.writeHead(500).end('boom'));
    process.env.CATALOG_SERVICE_URL = urlDe(servidor);

    await expect(new CatalogClient().listarTiendas()).rejects.toMatchObject({
      status: 503,
      message: 'Catálogo no disponible.',
    });
  });

  it('respuesta que no es JSON se traduce a 503, no a un 500 opaco', async () => {
    servidor = await levantar((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' }).end('<html>login</html>');
    });
    process.env.CATALOG_SERVICE_URL = urlDe(servidor);

    await expect(new CatalogClient().listarTiendas()).rejects.toMatchObject({ status: 503 });
  });

  it('si el catálogo acepta y no responde, corta por timeout y no se cuelga', async () => {
    // Puerto cerrado resuelve en milisegundos y no ejercita el timeout: lo
    // que hay que probar es un servidor que acepta y nunca contesta.
    servidor = await levantar(() => {});
    process.env.CATALOG_SERVICE_URL = urlDe(servidor);

    const inicio = Date.now();
    await expect(new CatalogClient().listarTiendas()).rejects.toMatchObject({ status: 503 });
    const transcurrido = Date.now() - inicio;

    servidor.closeAllConnections?.();
    expect(transcurrido).toBeGreaterThanOrEqual(2500);
    expect(transcurrido).toBeLessThan(6000);
  }, 15000);

  it('si catalog-service no responde, lanza 503 y no devuelve parciales', async () => {
    const s = await levantar((_req, res) => res.end());
    const url = urlDe(s);
    await cerrar(s);
    process.env.CATALOG_SERVICE_URL = url;

    const cliente = new CatalogClient();
    await expect(cliente.listarTiendas()).rejects.toThrow('Catálogo no disponible.');
    await expect(cliente.listarProductos()).rejects.toThrow('Catálogo no disponible.');
  });
});
