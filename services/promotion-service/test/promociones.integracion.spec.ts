/**
 * Integración de promotion-service contra el stack LOCAL real: PostgreSQL
 * (tablas de db/migraciones/sprint4_promotion.sql), Redis, auth-service
 * (sesiones reales), catalog-service y pricing-service (datos reales). La app
 * corre en este proceso con el MISMO `configurarApp` que main.ts. Cada XML se
 * valida contra el XSD OFICIAL (docs/contratos/promotion-service.xsd y
 * health.xsd) con libxml2 (xmllint-wasm).
 *
 * Requisitos (si falta alguno, la prueba FALLA diciendo qué):
 *   docker compose -f infra/docker-compose.yml up -d postgres redis auth-service catalog-service pricing-service
 *   docker exec -i retail_postgres psql -U retail_user -d retaildb < db/migraciones/sprint4_promotion.sql
 *   npm run test:integracion
 *
 * Escribe en `promociones` y `promocion_eventos` de la base local y al
 * terminar borra lo que creó. No toca tablas de otros servicios.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { AddressInfo } from 'net';
import { resolve } from 'path';
import { validateXML } from 'xmllint-wasm';
import { AppModule } from '../src/app.module';
import { configurarApp } from '../src/app.setup';
import { diaLocal } from '../src/common/fechas';

const AUTH = process.env.AUTH_BASE_URL ?? 'http://localhost:3101';
const PRICING = process.env.PRICING_SERVICE_URL as string;
const CATALOG = process.env.CATALOG_SERVICE_URL as string;
const POSTGRES = process.env.POSTGRES_CONTAINER ?? 'retail_postgres';
const CLAVE = process.env.PROMO_IT_PASSWORD ?? 'Passw0rd123!';
const XML = 'application/xml';

const CONTRATOS = resolve(__dirname, '../../../docs/contratos');
const XSD = readFileSync(resolve(CONTRATOS, 'promotion-service.xsd'), 'utf8');
const HEALTH_XSD = readFileSync(resolve(CONTRATOS, 'health.xsd'), 'utf8');

async function erroresXsd(xml: string, xsd = XSD): Promise<string[]> {
  const r = await validateXML({ xml: [{ fileName: 'r.xml', contents: xml }], schema: [{ fileName: 's.xsd', contents: xsd }] });
  return r.valid ? [] : r.errors.map((e) => e.rawMessage.trim());
}

function sql(consulta: string): string[] {
  return execFileSync('docker', ['exec', POSTGRES, 'psql', '-U', 'retail_user', '-d', 'retaildb', '-t', '-A', '-F', '|', '-c', consulta], {
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .filter(Boolean);
}

async function entrar(email: string): Promise<string> {
  const r = await fetch(`${AUTH}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: CLAVE }),
  });
  const cuerpo = (await r.json()) as { accessToken?: string };
  if (!cuerpo.accessToken) throw new Error(`No se pudo iniciar sesión como ${email} en ${AUTH} (HTTP ${r.status}).`);
  return cuerpo.accessToken;
}

interface Respuesta {
  estado: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
  texto: string;
}

/** Revisa lo que el stack necesita; si falta algo, dice exactamente qué. */
async function requisitos(): Promise<string[]> {
  const faltan: string[] = [];
  for (const [nombre, url] of [['auth-service', AUTH], ['catalog-service', CATALOG], ['pricing-service', PRICING]]) {
    try {
      const r = await fetch(`${url}/v1/health`, { signal: AbortSignal.timeout(3000) });
      if (!r.ok) faltan.push(`${nombre} responde ${r.status} en ${url}/v1/health`);
    } catch {
      faltan.push(`${nombre} no responde en ${url} (docker compose -f infra/docker-compose.yml up -d ${nombre})`);
    }
  }
  try {
    const [promociones, eventos] = sql(
      "SELECT to_regclass('public.promociones') IS NOT NULL; SELECT to_regclass('public.promocion_eventos') IS NOT NULL;",
    );
    if (promociones !== 't' || eventos !== 't') {
      faltan.push('faltan las tablas promociones / promocion_eventos: aplica db/migraciones/sprint4_promotion.sql');
    }
  } catch (e) {
    faltan.push(`no se pudo revisar la base en el contenedor ${POSTGRES}: ${(e as Error).message.split('\n')[0]}`);
  }
  return faltan;
}

describe('promotion-service · integración (Postgres, Redis, auth, catalog y pricing reales)', () => {
  let app: INestApplication;
  let base: string;
  let gerente: string;
  let precios: string;
  let analista: string;
  let proveedor: string;
  /** Producto activo con una presentación activa en masa (kg/g) que tiene precio vigente en una tienda. */
  let dato: { productId: string; presentationId: string; storeId: string; zoneId: string; contenidoBase: number };
  let precioRegular: number;
  const creadas: string[] = [];
  const hoy = diaLocal();
  const enDias = (n: number) => new Date(Date.parse(`${hoy}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    const faltan = await requisitos();
    if (faltan.length) throw new Error(`No se puede correr la integración. Falta:\n - ${faltan.join('\n - ')}`);

    [gerente, precios, analista, proveedor] = await Promise.all([
      entrar('gercategoria@retail.mx'),
      entrar('precios@retail.mx'),
      entrar('analista@retail.mx'),
      entrar('contacto@bioorganicos.mx'),
    ]);

    // Candidatas por SQL (solo lectura); el precio que vale es el que da pricing por HTTP.
    const candidatas = sql(
      `SELECT pp.producto_id, pp.id, t.id, t.zona_id, pp.contenido * u.factor_base
         FROM precios pr
         JOIN producto_presentaciones pp ON pp.id = pr.presentacion_id AND pp.activo
         JOIN productos p ON p.id = pp.producto_id AND p.estatus::text = 'activo'
         JOIN unidades_medida u ON u.id = pp.unidad_medida_id AND u.tipo::text = 'masa'
         JOIN tiendas t ON t.id = pr.tienda_id AND t.activo
        WHERE pr.fecha_vigencia_desde <= current_date
          AND (pr.fecha_vigencia_hasta IS NULL OR pr.fecha_vigencia_hasta >= current_date)
        ORDER BY pp.id, t.id LIMIT 20`,
    );
    for (const fila of candidatas) {
      const [productId, presentationId, storeId, zoneId, contenidoBase] = fila.split('|');
      const r = await fetch(`${PRICING}/v1/prices/current?presentationId=${presentationId}&storeId=${storeId}`, {
        headers: { Authorization: `Bearer ${precios}` },
      });
      const cuerpo = (await r.json()) as { data?: Array<{ price: string }> };
      if (r.ok && cuerpo.data?.[0]) {
        dato = { productId, presentationId, storeId, zoneId, contenidoBase: Number(contenidoBase) };
        precioRegular = Number(cuerpo.data[0].price);
        break;
      }
    }
    if (!dato) throw new Error('No hay un producto activo en kg/g con precio vigente en una tienda activa: carga el seed.');

    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = modulo.createNestApplication({ logger: process.env.PROMO_IT_LOGS === '1' ? undefined : false });
    configurarApp(app);
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app?.close();
    if (creadas.length) {
      const ids = creadas.map((id) => `'${id}'`).join(',');
      sql(`DELETE FROM promocion_eventos WHERE promocion_id IN (${ids}); DELETE FROM promociones WHERE id IN (${ids});`);
    }
  });

  async function http(
    metodo: string,
    ruta: string,
    { token, json, xml, accept }: { token?: string; json?: unknown; xml?: string; accept?: string } = {},
  ): Promise<Respuesta> {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (accept) headers.Accept = accept;
    let body: string | undefined;
    if (json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(json);
    } else if (xml !== undefined) {
      headers['Content-Type'] = 'application/xml';
      body = xml;
    }
    const r = await fetch(`${base}${ruta}`, { method: metodo, headers, body });
    const texto = await r.text();
    const esJson = (r.headers.get('content-type') ?? '').includes('json');
    return { estado: r.status, json: esJson && texto ? JSON.parse(texto) : null, texto };
  }

  function cuerpo(parcial: Record<string, unknown>) {
    return {
      name: `IT promoción ${parcial.type ?? 'descuento_porcentual'}`,
      type: 'descuento_porcentual',
      productId: dato.productId,
      presentationId: dato.presentationId,
      storeId: dato.storeId,
      discountPct: 10,
      validFrom: hoy,
      validTo: enDias(14),
      ...parcial,
    };
  }

  async function proponer(parcial: Record<string, unknown>): Promise<string> {
    const r = await http('POST', '/v1/promotions', { token: gerente, json: cuerpo(parcial) });
    expect(r.estado).toBe(201);
    creadas.push(r.json.id);
    return r.json.id;
  }

  const DESCUENTO = { type: 'descuento_porcentual', discountPct: 10 };
  const PAQUETE = { type: 'paquete', discountPct: undefined, packQuantity: 3 };
  /** Tamaño de empaque: 1.2 veces el contenido de la presentación (en g), al mismo precio regular. */
  const empaque = () => ({
    type: 'tamano_empaque',
    discountPct: undefined,
    promoContent: Math.round(dato.contenidoBase * 1.2 * 1000 * 1000) / 1000,
    promoUnit: 'g',
    promoPrice: precioRegular,
  });

  let descuentoId: string;

  it('Gerente propone (JSON) → 201 pendiente; en XML el mismo recurso valida contra el XSD', async () => {
    descuentoId = await proponer(DESCUENTO);
    const r = await http('GET', `/v1/promotions/${descuentoId}`, { token: analista, accept: XML });
    expect(r.estado).toBe(200);
    expect(r.texto).toContain('<status>pendiente</status>');
    expect(await erroresXsd(r.texto)).toEqual([]);
  });

  it('Gerente propone en XML (Content-Type y Accept XML) → 201 con promocionResponse válido', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<promocionRequest xmlns="promotion/v1">
  <name>IT paquete en XML</name>
  <type>paquete</type>
  <productId>${dato.productId}</productId>
  <presentationId>${dato.presentationId}</presentationId>
  <storeId>${dato.storeId}</storeId>
  <packQuantity>3</packQuantity>
  <packPrice>${(precioRegular * 2.5).toFixed(2)}</packPrice>
  <validFrom>${hoy}</validFrom>
  <validTo>${enDias(7)}</validTo>
</promocionRequest>`;
    expect(await erroresXsd(xml)).toEqual([]); // la petición también cumple el XSD
    const r = await http('POST', '/v1/promotions', { token: gerente, xml, accept: XML });
    expect(r.estado).toBe(201);
    expect(await erroresXsd(r.texto)).toEqual([]);
    creadas.push(/<id>([^<]+)<\/id>/.exec(r.texto)![1]);
  });

  it('Responsable de precios intenta proponer → 403', async () => {
    const r = await http('POST', '/v1/promotions', { token: precios, json: cuerpo(DESCUENTO) });
    expect(r.estado).toBe(403);
    expect(r.json.message).toBe('Solo el Gerente de categoría propone promociones.');
  });

  it('sin sesión → 401 (y en XML, error válido contra el XSD)', async () => {
    const r = await http('POST', '/v1/promotions', { json: cuerpo(DESCUENTO), accept: XML });
    expect(r.estado).toBe(401);
    expect(await erroresXsd(r.texto)).toEqual([]);
  });

  it('XML con DOCTYPE → 400; tamaño de empaque en ml sobre una presentación en masa → 400 unidades incompatibles', async () => {
    const xml = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><promocionRequest xmlns="promotion/v1"><name>&e;</name></promocionRequest>`;
    const r = await http('POST', '/v1/promotions', { token: gerente, xml, accept: XML });
    expect(r.estado).toBe(400);
    expect(await erroresXsd(r.texto)).toEqual([]);
    expect(r.texto).toContain('DOCTYPE');

    const ml = await http('POST', '/v1/promotions', { token: gerente, json: cuerpo({ ...empaque(), promoUnit: 'ml' }) });
    expect(ml.estado).toBe(400);
    expect(ml.json.message).toBe('Unidades incompatibles.');
    expect(ml.json.details[0]).toMatch(/^promoUnit: ml \(volumen\) no se compara con la presentación en (kg|g) \(masa\)$/);
  });

  it('Gerente intenta aprobar → 403 con el mensaje del contrato', async () => {
    const r = await http('PATCH', `/v1/promotions/${descuentoId}/approve`, { token: gerente });
    expect(r.estado).toBe(403);
    expect(r.json.message).toBe('Solo el Responsable de precios aprueba promociones.');
  });

  it('Responsable de precios aprueba → 200 (XML válido); aprobar otra vez → 409 (XML válido)', async () => {
    const r = await http('PATCH', `/v1/promotions/${descuentoId}/approve`, { token: precios, accept: XML });
    expect(r.estado).toBe(200);
    expect(r.texto).toContain('<status>aprobada</status>');
    expect(await erroresXsd(r.texto)).toEqual([]);

    const otra = await http('PATCH', `/v1/promotions/${descuentoId}/approve`, { token: precios, accept: XML });
    expect(otra.estado).toBe(409);
    expect(otra.texto).toContain('La promoción ya está aprobada; no se resuelve dos veces.');
    expect(await erroresXsd(otra.texto)).toEqual([]);
  });

  it('rechazar sin motivo → 400; con motivo (en XML) → 200 rechazada sin validity', async () => {
    const id = await proponer({ ...DESCUENTO, name: 'IT para rechazar' });
    const sin = await http('PATCH', `/v1/promotions/${id}/reject`, { token: precios, json: {} });
    expect(sin.estado).toBe(400);
    expect(sin.json.details).toContain('reason debe tener entre 10 y 500 caracteres');

    const xml = `<?xml version="1.0" encoding="UTF-8"?><rechazoPromocionRequest xmlns="promotion/v1"><reason>Se encima con la campaña de regreso a clases.</reason></rechazoPromocionRequest>`;
    const r = await http('PATCH', `/v1/promotions/${id}/reject`, { token: precios, xml, accept: XML });
    expect(r.estado).toBe(200);
    expect(r.texto).toContain('<status>rechazada</status>');
    expect(r.texto).not.toContain('<validity>');
    expect(await erroresXsd(r.texto)).toEqual([]);
  });

  it('unit-price con datos reales: regular de pricing y descuento del 10 % (JSON y XML)', async () => {
    const r = await http('GET', `/v1/promotions/${descuentoId}/unit-price`, { token: analista });
    expect(r.estado).toBe(200);
    const unitarioRegular = precioRegular / dato.contenidoBase;
    expect(r.json).toMatchObject({
      disponible: true,
      baseUnit: 'kg',
      storeId: dato.storeId,
      regular: { disponible: true, price: precioRegular, unitPrice: Math.round(unitarioRegular * 100) / 100 },
      savingsPct: 10,
    });
    const x = await http('GET', `/v1/promotions/${descuentoId}/unit-price`, { token: analista, accept: XML });
    expect(await erroresXsd(x.texto)).toEqual([]);
  });

  it('compare con datos reales: tamaño → paquete → descuento (JSON y XML)', async () => {
    // Paquete 3 por (2.6 × regular): unitario = 0.8667 × regular, entre el empaque (0.8333) y el descuento (0.90).
    const paquete = await proponer({ ...PAQUETE, packPrice: Math.round(precioRegular * 2.6 * 100) / 100 });
    const tamano = await proponer(empaque());
    const ruta = `/v1/promotions/compare?ids=${descuentoId},${paquete},${tamano}&storeId=${dato.storeId}`;
    const r = await http('GET', ruta, { token: analista });
    expect(r.estado).toBe(200);
    expect(r.json.data.map((d: { promotionId: string }) => d.promotionId)).toEqual([tamano, paquete, descuentoId]);
    expect(r.json.data.map((d: { savingsPct: number }) => d.savingsPct)).toEqual([16.67, expect.any(Number), 10]);
    const x = await http('GET', ruta, { token: analista, accept: XML });
    expect(await erroresXsd(x.texto)).toEqual([]);
  });

  it('lista (filtros) en XML válida; Proveedor → 403; status=vigente → 400', async () => {
    const r = await http('GET', `/v1/promotions?productId=${dato.productId}&status=aprobada`, { token: analista, accept: XML });
    expect(r.estado).toBe(200);
    expect(await erroresXsd(r.texto)).toEqual([]);
    expect((await http('GET', '/v1/promotions', { token: proveedor })).estado).toBe(403);
    expect((await http('GET', '/v1/promotions?status=vigente', { token: analista })).estado).toBe(400);
  });

  it('auditoría y aviso no bloquean: el evento queda con su estado de entrega en promocion_eventos', async () => {
    // Se le da tiempo a la entrega (timeout de 1.5 s por destino).
    await new Promise((r) => setTimeout(r, 2000));
    const filas = sql(`SELECT evento, auditoria_estado, aviso_estado FROM promocion_eventos WHERE promocion_id = '${descuentoId}' ORDER BY ocurrido_en`);
    expect(filas.map((f) => f.split('|')[0])).toEqual(['propuesta', 'aprobada']);
    for (const f of filas) {
      const [, auditoria, aviso] = f.split('|');
      expect(['enviado', 'fallido', 'no_aplica']).toContain(auditoria);
      expect(['enviado', 'fallido', 'no_aplica']).toContain(aviso);
    }
  });

  it('GET /v1/health: postgres y redis ok, mongodb no configurado; XML válido contra health.xsd', async () => {
    const r = await http('GET', '/v1/health');
    expect(r.json.checks).toEqual({ postgres: 'ok', mongodb: 'no configurado', redis: 'ok' });
    const x = await http('GET', '/v1/health', { accept: XML });
    expect(await erroresXsd(x.texto, HEALTH_XSD)).toEqual([]);
  });
});
