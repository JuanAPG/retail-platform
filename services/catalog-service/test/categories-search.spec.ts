/**
 * Integración de T-21 contra el servicio real (Postgres + Redis): alta, cambio y baja de
 * categorías (D-07) y búsqueda con filtros en productos, tiendas y zonas.
 *
 * Requiere: `docker compose up -d postgres redis catalog-service` con el seed cargado.
 *   npm run test:integracion
 *
 * No depende de auth-service: firma el JWT y abre la sesión en Redis. Todo lo que crea lleva el
 * prefijo `IT21` y se borra al terminar.
 */
import { spawnSync } from 'child_process';
import Redis from 'ioredis';
import { sign } from 'jsonwebtoken';
import { join } from 'path';
import { Client } from 'pg';

const BASE = process.env.CATALOG_BASE_URL ?? 'http://localhost:3102';
const SECRET = process.env.JWT_ACCESS_SECRET ?? 'dev_access_secret_solo_para_local';
const XSD = join(__dirname, '..', '..', '..', 'docs', 'contratos', 'catalog-service.xsd');
const PREFIJO = 'IT21';

const redis = new Redis({
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
});

async function sesion(userId: string, rol: string): Promise<string> {
  await redis.set(`session:${userId}`, '1', 'EX', 600);
  return sign({ sub: userId, email: `${userId}@test`, rol, rolId: 1, jti: `jti-${userId}-${Date.now()}` }, SECRET, {
    expiresIn: '10m',
  });
}

async function conDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
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

async function http(metodo: string, ruta: string, token?: string, cuerpo?: object, accept?: string) {
  const respuesta = await fetch(`${BASE}${ruta}`, {
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { estado: respuesta.status, cuerpo: (texto && esJson ? JSON.parse(texto) : null) as any, texto };
}

/** `null` si el XML valida contra catalog-service.xsd; `'sin-validador'` si no hay Python con lxml. */
function errorDeXsd(xml: string): string | null {
  const codigo =
    'import sys\ntry:\n    from lxml import etree\nexcept ImportError:\n    sys.exit(3)\n' +
    's = etree.XMLSchema(etree.parse(sys.argv[1]))\nd = etree.fromstring(sys.stdin.buffer.read())\n' +
    'ok = s.validate(d)\nprint("" if ok else "; ".join(str(e) for e in s.error_log))\nsys.exit(0 if ok else 1)\n';
  for (const python of ['python', 'python3']) {
    const corrida = spawnSync(python, ['-c', codigo, XSD], { input: xml, encoding: 'utf8' });
    if (corrida.error || corrida.status === 3) continue;
    return corrida.status === 0 ? null : corrida.stdout.trim() || corrida.stderr.trim() || 'no valida';
  }
  return 'sin-validador';
}

async function limpiar() {
  await conDb(async (db) => {
    await db.query('DELETE FROM productos WHERE sku LIKE $1', [`${PREFIJO}-%`]);
    // De hijas a padres: la llave foránea a sí misma no deja borrar un padre con hijas.
    for (let i = 0; i < 4; i += 1) {
      await db.query(
        `DELETE FROM categorias_producto c WHERE c.nombre LIKE $1
           AND NOT EXISTS (SELECT 1 FROM categorias_producto h WHERE h.categoria_padre_id = c.id)`,
        [`${PREFIJO}%`],
      );
    }
  });
}

describe('T-21: categorías y búsqueda (integración, requiere stack)', () => {
  let gerente: string;
  let admin: string;
  let analista: string;
  let proveedor: string;
  let raizId: number;
  let hijaId: number;

  const ids = (cuerpo: { data: Array<{ id: string }> }) => cuerpo.data.map((x) => x.id);

  beforeAll(async () => {
    await limpiar();
    gerente = await sesion('it21-gerente', 'Gerente de categoría');
    admin = await sesion('it21-admin', 'Administrador');
    analista = await sesion('it21-analista', 'Analista comercial');
    proveedor = await sesion('it21-proveedor', 'Proveedor');
  });

  afterAll(async () => {
    await limpiar();
    await redis.quit();
  });

  describe('categorías: alta, cambio y baja', () => {
    it('solo el Gerente de categoría las escribe (M04); sin token → 401', async () => {
      const cuerpo = { nombre: `${PREFIJO} Prohibida` };
      expect((await http('POST', '/v1/product-categories', undefined, cuerpo)).estado).toBe(401);
      expect((await http('POST', '/v1/product-categories', admin, cuerpo)).estado).toBe(403);
      expect((await http('POST', '/v1/product-categories', analista, cuerpo)).estado).toBe(403);
      expect((await http('POST', '/v1/product-categories', proveedor, cuerpo)).estado).toBe(403);
    });

    it('alta: nace activa y aparece de inmediato en el catálogo (la caché se invalida)', async () => {
      await http('GET', '/v1/product-categories', gerente); // deja el catálogo cacheado
      const r = await http('POST', '/v1/product-categories', gerente, { nombre: `${PREFIJO} Raíz`, descripcion: 'De prueba' });
      expect(r.estado).toBe(201);
      expect(r.cuerpo).toMatchObject({ nombre: `${PREFIJO} Raíz`, categoriaPadreId: null, descripcion: 'De prueba', activo: true });
      raizId = r.cuerpo.id;
      const lista = await http('GET', '/v1/product-categories', proveedor);
      expect(lista.cuerpo.some((c: { id: number }) => c.id === raizId)).toBe(true);
    });

    it('validaciones: nombre repetido → 409; sin nombre, campo extra o padre inexistente → 400', async () => {
      expect((await http('POST', '/v1/product-categories', gerente, { nombre: `  ${PREFIJO} raíz ` })).estado).toBe(409);
      expect((await http('POST', '/v1/product-categories', gerente, { descripcion: 'x' })).estado).toBe(400);
      expect((await http('POST', '/v1/product-categories', gerente, { nombre: `${PREFIJO} X`, color: 'rojo' })).estado).toBe(400);
      expect((await http('POST', '/v1/product-categories', gerente, { nombre: `${PREFIJO} X`, categoriaPadreId: 31999 })).estado).toBe(400);
    });

    it('subcategoría y cambio; no puede colgar de sí misma ni de su hija (400)', async () => {
      const hija = await http('POST', '/v1/product-categories', gerente, { nombre: `${PREFIJO} Hija`, categoriaPadreId: raizId });
      expect(hija.estado).toBe(201);
      hijaId = hija.cuerpo.id;

      const editada = await http('PATCH', `/v1/product-categories/${hijaId}`, gerente, { nombre: `${PREFIJO} Hija editada`, descripcion: 'Nueva' });
      expect(editada.estado).toBe(200);
      expect(editada.cuerpo).toMatchObject({ nombre: `${PREFIJO} Hija editada`, descripcion: 'Nueva', categoriaPadreId: raizId });

      expect((await http('PATCH', `/v1/product-categories/${raizId}`, gerente, { categoriaPadreId: raizId })).estado).toBe(400);
      expect((await http('PATCH', `/v1/product-categories/${raizId}`, gerente, { categoriaPadreId: hijaId })).estado).toBe(400);
      expect((await http('PATCH', `/v1/product-categories/${hijaId}`, gerente, { nombre: `${PREFIJO} Raíz` })).estado).toBe(409);
      expect((await http('PATCH', '/v1/product-categories/31999', gerente, { nombre: 'x' })).estado).toBe(404);
      expect((await http('PATCH', '/v1/product-categories/abc', gerente, { nombre: 'x' })).estado).toBe(400);
    });

    it('baja de una categoría con subcategorías: no se borra, queda desactivada (200)', async () => {
      const r = await http('DELETE', `/v1/product-categories/${raizId}`, gerente);
      expect(r.estado).toBe(200);
      expect(r.cuerpo).toMatchObject({ id: raizId, activo: false });
      await http('PATCH', `/v1/product-categories/${raizId}`, gerente, { activo: true });
    });

    it('baja con productos (D-07): se desactiva, el producto la conserva y ya no acepta productos nuevos', async () => {
      const producto = await http('POST', '/v1/products', gerente, {
        sku: `${PREFIJO}-CAT-001`,
        nombre: `${PREFIJO} producto con categoría`,
        categoriaId: hijaId,
        presentacion: '1 kg',
        contenido: 1,
        unidadMedida: 'kg',
      });
      expect(producto.estado).toBe(201);

      const baja = await http('DELETE', `/v1/product-categories/${hijaId}`, gerente);
      expect(baja.estado).toBe(200);
      expect(baja.cuerpo).toMatchObject({ id: hijaId, activo: false });

      // Sale del catálogo normal y sigue visible para administrarla.
      const activas = await http('GET', '/v1/product-categories', gerente);
      expect(activas.cuerpo.some((c: { id: number }) => c.id === hijaId)).toBe(false);
      const todas = await http('GET', '/v1/product-categories?includeInactive=true', gerente);
      expect(todas.cuerpo.find((c: { id: number }) => c.id === hijaId)).toMatchObject({ activo: false });

      // El producto conserva su categoría.
      const detalle = await http('GET', `/v1/products/${producto.cuerpo.id}`, gerente);
      expect(detalle.cuerpo.categoria).toMatchObject({ id: hijaId, activo: false });

      // No recibe productos nuevos.
      const otro = await http('POST', '/v1/products', gerente, {
        sku: `${PREFIJO}-CAT-002`,
        nombre: 'No debería crearse',
        categoriaId: hijaId,
        presentacion: '1 kg',
        contenido: 1,
        unidadMedida: 'kg',
      });
      expect(otro.estado).toBe(400);
      expect(otro.cuerpo.message).toMatch(/desactivada/);
    });

    it('baja de una categoría sin nada que dependa de ella: se borra (204)', async () => {
      const suelta = await http('POST', '/v1/product-categories', gerente, { nombre: `${PREFIJO} Suelta` });
      const r = await http('DELETE', `/v1/product-categories/${suelta.cuerpo.id}`, gerente);
      expect(r.estado).toBe(204);
      expect(r.texto).toBe('');
      expect((await http('DELETE', `/v1/product-categories/${suelta.cuerpo.id}`, gerente)).estado).toBe(404);
    });

    it('el XML de categorías valida contra el XSD (con `activo`)', async () => {
      const validar = (xml: string) => {
        const error = errorDeXsd(xml);
        if (error === 'sin-validador') return console.warn('Sin Python + lxml: no se validó el XML contra el XSD.');
        expect(error).toBeNull();
      };
      const lista = await http('GET', '/v1/product-categories?includeInactive=true', gerente, undefined, 'application/xml');
      expect(lista.texto).toContain('<categoryListResponse xmlns="catalog/v1"');
      validar(lista.texto);
      const una = await http('PATCH', `/v1/product-categories/${raizId}`, gerente, { descripcion: null }, 'application/xml');
      expect(una.texto).toContain('<categoryResponse xmlns="catalog/v1"');
      validar(una.texto);
      const productos = await http('GET', `/v1/products?search=${PREFIJO}`, gerente, undefined, 'application/xml');
      validar(productos.texto);
    });
  });

  describe('búsqueda y filtros en productos', () => {
    let categoriaId: number;
    let basicoId: string;
    let normalId: string;

    beforeAll(async () => {
      const categoria = await http('POST', '/v1/product-categories', gerente, { nombre: `${PREFIJO} Búsqueda` });
      categoriaId = categoria.cuerpo.id;
      const alta = (sku: string, nombre: string, extra: object) =>
        http('POST', '/v1/products', gerente, { sku, nombre, categoriaId, presentacion: '1 pza', contenido: 1, unidadMedida: 'kg', ...extra });
      basicoId = (await alta(`${PREFIJO}-BUS-A`, `${PREFIJO} Zanahoria 100% natural`, { esCanastaBasica: true, descripcion: 'Hortaliza fresca' })).cuerpo.id;
      normalId = (await alta(`${PREFIJO}-BUS-B`, `${PREFIJO} Refresco de cola`, { descripcion: 'Bebida azucarada' })).cuerpo.id;
    });

    it('busca en nombre, SKU y descripción, sin distinguir mayúsculas', async () => {
      expect(ids((await http('GET', '/v1/products?search=zanahoria', analista)).cuerpo)).toEqual([basicoId]);
      expect(ids((await http('GET', `/v1/products?search=${PREFIJO.toLowerCase()}-bus-b`, analista)).cuerpo)).toEqual([normalId]);
      expect(ids((await http('GET', '/v1/products?search=AZUCARADA', analista)).cuerpo)).toEqual([normalId]);
    });

    it('`%` y `_` se buscan tal cual, no como comodines', async () => {
      expect(ids((await http('GET', `/v1/products?search=${encodeURIComponent('100%')}`, analista)).cuerpo)).toEqual([basicoId]);
      const comodin = await http('GET', `/v1/products?search=${encodeURIComponent(`${PREFIJO}_Zanahoria`)}`, analista);
      expect(comodin.cuerpo.total).toBe(0);
    });

    it('filtra por categoría y por canasta básica, y los combina con la búsqueda', async () => {
      const deLaCategoria = await http('GET', `/v1/products?categoriaId=${categoriaId}`, analista);
      expect(ids(deLaCategoria.cuerpo).sort()).toEqual([basicoId, normalId].sort());
      const basicos = await http('GET', `/v1/products?categoriaId=${categoriaId}&esCanastaBasica=true`, analista);
      expect(ids(basicos.cuerpo)).toEqual([basicoId]);
      const noBasicos = await http('GET', `/v1/products?categoriaId=${categoriaId}&esCanastaBasica=false`, analista);
      expect(ids(noBasicos.cuerpo)).toEqual([normalId]);
      const combinado = await http('GET', `/v1/products?search=${PREFIJO}&categoriaId=${categoriaId}&esCanastaBasica=true&limit=1`, analista);
      expect(combinado.cuerpo).toMatchObject({ total: 1, page: 1, limit: 1 });
    });

    it('sigue paginando y sin resultados devuelve una página vacía', async () => {
      const pagina2 = await http('GET', `/v1/products?categoriaId=${categoriaId}&limit=1&page=2`, analista);
      expect(pagina2.cuerpo).toMatchObject({ total: 2, page: 2, limit: 1 });
      expect(pagina2.cuerpo.data).toHaveLength(1);
      const nada = await http('GET', '/v1/products?search=no-existe-este-texto-xyz', analista);
      expect(nada.cuerpo).toMatchObject({ data: [], total: 0 });
    });

    it('la búsqueda no salta el recorte por perfil (D-08): un producto inactivo no aparece para el Analista', async () => {
      await conDb((db) => db.query("UPDATE productos SET estatus = 'inactivo' WHERE id = $1", [normalId]));
      expect((await http('GET', '/v1/products?search=refresco%20de%20cola', analista)).cuerpo.total).toBe(0);
      const revisor = await http('GET', '/v1/products?search=refresco%20de%20cola&estatus=inactivo', gerente);
      expect(ids(revisor.cuerpo)).toEqual([normalId]);
    });

    it('filtros mal formados o desconocidos → 400', async () => {
      expect((await http('GET', '/v1/products?categoriaId=abc', analista)).estado).toBe(400);
      expect((await http('GET', '/v1/products?esCanastaBasica=quiza', analista)).estado).toBe(400);
      expect((await http('GET', `/v1/products?search=${'a'.repeat(101)}`, analista)).estado).toBe(400);
      expect((await http('GET', '/v1/products?marca=x', analista)).estado).toBe(400);
    });
  });

  describe('búsqueda y filtros en tiendas y zonas', () => {
    it('tiendas: por texto, por zona y por formato, combinados', async () => {
      const todas = await http('GET', '/v1/stores?limit=100', analista);
      const muestra = todas.cuerpo.data[0];
      const porNombre = await http('GET', `/v1/stores?search=${encodeURIComponent(muestra.nombre.toUpperCase())}`, analista);
      expect(ids(porNombre.cuerpo)).toContain(muestra.id);

      const deLaZona = await http('GET', `/v1/stores?zonaId=${muestra.zonaId}&limit=100`, analista);
      expect(deLaZona.cuerpo.total).toBe(todas.cuerpo.data.filter((t: { zonaId: string }) => t.zonaId === muestra.zonaId).length);
      expect(deLaZona.cuerpo.data.every((t: { zonaId: string }) => t.zonaId === muestra.zonaId)).toBe(true);

      const porFormato = await http('GET', `/v1/stores?formato=${muestra.formato}&zonaId=${muestra.zonaId}`, analista);
      expect(porFormato.cuerpo.data.every((t: { formato: string }) => t.formato === muestra.formato)).toBe(true);
      expect(ids(porFormato.cuerpo)).toContain(muestra.id);

      expect((await http('GET', '/v1/stores?search=no-existe-esta-tienda-xyz', analista)).cuerpo.total).toBe(0);
      expect((await http('GET', '/v1/stores?zonaId=zona-1', analista)).estado).toBe(400);
      expect((await http('GET', '/v1/stores?formato=tianguis', analista)).estado).toBe(400);
    });

    it('zonas: por texto, por municipio y por activo', async () => {
      const todas = await http('GET', '/v1/zones?limit=100', analista);
      const muestra = todas.cuerpo.data[0];
      const porNombre = await http('GET', `/v1/zones?search=${encodeURIComponent(muestra.nombre.toLowerCase())}`, analista);
      expect(ids(porNombre.cuerpo)).toContain(muestra.id);

      const delMunicipio = await http('GET', `/v1/zones?municipioId=${muestra.municipioId}&limit=100`, analista);
      expect(delMunicipio.cuerpo.data.every((z: { municipioId: number }) => z.municipioId === muestra.municipioId)).toBe(true);
      expect(delMunicipio.cuerpo.total).toBe(todas.cuerpo.data.filter((z: { municipioId: number }) => z.municipioId === muestra.municipioId).length);

      const activas = await http('GET', '/v1/zones?activo=true&limit=100', analista);
      const inactivas = await http('GET', '/v1/zones?activo=false&limit=100', analista);
      expect(activas.cuerpo.total + inactivas.cuerpo.total).toBe(todas.cuerpo.total);
      expect(inactivas.cuerpo.data.every((z: { activo: boolean }) => z.activo === false)).toBe(true);

      expect((await http('GET', '/v1/zones?municipioId=x', analista)).estado).toBe(400);
      expect((await http('GET', '/v1/zones?activo=tal-vez', analista)).estado).toBe(400);
    });
  });
});
