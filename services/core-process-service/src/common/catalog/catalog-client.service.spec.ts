import { CatalogClient } from './catalog-client.service';

describe('CatalogClient (degradación)', () => {
  it('si catalog-service no responde, lanza 503 y no devuelve parciales', async () => {
    process.env.CATALOG_SERVICE_URL = 'http://127.0.0.1:9';
    const cliente = new CatalogClient();
    await expect(cliente.listarTiendas('Bearer x')).rejects.toThrow('Catálogo no disponible.');
    await expect(cliente.listarProductos('Bearer x')).rejects.toThrow('Catálogo no disponible.');
  });
});
