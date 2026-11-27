import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, errorDeRespuesta, http, pedir } from '../src/api/httpClient';
import { parseStorePage } from '../src/api/catalogParsers';
import { cuerpoSimulacionEmpaque, cuerpoSimulacionPrecio, simularEmpaque, simularPrecio } from '../src/api/decisionApi';
import {
  aprobarPromocion,
  camposDelTipo,
  compararPromociones,
  cuerpoRechazo,
  mensajeConflictoPromocion,
  motivoNoComparable,
  ordenarComparacion,
  parseComparacion,
  parsePrecioUnitario,
  parsePromocion,
  parsePromociones,
  rechazarPromocion,
} from '../src/api/promotionApi';
import {
  cuerpoImplementacion,
  estadoActualDe409,
  indicePaso,
  listarSeguimientos,
  marcarImplementada,
  mensajeConflictoSeguimiento,
  parseHistorial,
  parseSeguimiento,
  parseSeguimientos,
} from '../src/api/workflowApi';
import { ROL, accionesSeguimiento, menuParaRol, puede } from '../src/config/menu';
import { NAMESPACE, construirXml, exigirRaiz, leerXml } from '../src/api/xml';
import { XSD, ejemplosXmlDelContrato, erroresXsd, fixture } from './apoyo';

/**
 * Promociones (promotion-service, D-39), seguimiento de recomendaciones (workflow, D-41) y la
 * simulación en XML (decision-service). Contratos en docs/contratos/.
 */

const ESCRITORIO = [ROL.ANALISTA, ROL.RESPONSABLE_PRECIOS, ROL.PLANEADOR];
const ASIGNADO = '3b4c5d6e-7f80-4b9c-8d1e-2f3a4b5c6d7e';
const OTRO = '9d2e7f40-5a61-4c1b-8e3f-2b7c9a0d4e55';

/** Contenido de la raíz de un ejemplo del contrato, leído como lo hace `pedir`. */
function delContrato(md: string, raiz: string, ns: string, n = 0): any {
  const ejemplos = ejemplosXmlDelContrato(md).filter((e) => e.raiz === raiz);
  if (!ejemplos[n]) throw new Error(`El contrato ${md} no trae el ejemplo <${raiz}> #${n}`);
  return exigirRaiz(leerXml(ejemplos[n].xml), raiz, ns);
}
const PROMO_MD = 'promotion-service.md';
const WF_MD = 'recommendations-workflow-service.md';

// ---------------------------------------------------------------------------------------------
// Menú y permisos
// ---------------------------------------------------------------------------------------------

describe('menú y permisos', () => {
  it('las dos secciones nuevas las ven los 3 perfiles del escritorio, con su servicio', () => {
    for (const rol of ESCRITORIO) {
      const items = menuParaRol(rol);
      expect(items.find((m) => m.path === '/promociones')?.servicio).toMatch(/^promotion-service/);
      expect(items.find((m) => m.path === '/seguimiento')?.servicio).toMatch(/^recommendations-workflow-service/);
    }
  });

  it('aprobar y rechazar promociones: solo el Responsable de precios', () => {
    expect(puede(ROL.RESPONSABLE_PRECIOS, 'resolverPromociones')).toBe(true);
    for (const rol of [ROL.ANALISTA, ROL.PLANEADOR, ROL.GERENTE, ROL.ADMINISTRADOR, null]) {
      expect(puede(rol, 'resolverPromociones')).toBe(false);
    }
  });

  it('nadie propone promociones, ni asigna ni evalúa seguimientos en el escritorio (va en la web)', () => {
    for (const rol of [...ESCRITORIO, ROL.GERENTE, ROL.ADMINISTRADOR]) {
      expect(puede(rol, 'proponerPromocion')).toBe(false);
      expect(puede(rol, 'asignarSeguimiento')).toBe(false);
      expect(puede(rol, 'evaluarSeguimiento')).toBe(false);
    }
  });

  it('botones de seguimiento: solo el asignado, y solo el paso que sigue', () => {
    const s = (status: string) => ({ assigneeUserId: ASIGNADO, status });
    expect(accionesSeguimiento(ASIGNADO, ROL.ANALISTA, s('asignada'))).toEqual(['iniciar']);
    expect(accionesSeguimiento(ASIGNADO, ROL.ANALISTA, s('en_implementacion'))).toEqual(['implementar']);
    expect(accionesSeguimiento(ASIGNADO.toUpperCase(), ROL.PLANEADOR, s('asignada'))).toEqual(['iniciar']);
    expect(accionesSeguimiento(ASIGNADO, ROL.ANALISTA, s('implementada'))).toEqual([]);
    expect(accionesSeguimiento(ASIGNADO, ROL.ANALISTA, s('evaluada'))).toEqual([]);
  });

  it('botones de seguimiento: otro usuario (aunque sea del mismo rol), sin sesión o rol no asignable, ninguno', () => {
    const s = { assigneeUserId: ASIGNADO, status: 'asignada' };
    for (const rol of ESCRITORIO) expect(accionesSeguimiento(OTRO, rol, s)).toEqual([]);
    expect(accionesSeguimiento(null, ROL.ANALISTA, s)).toEqual([]);
    expect(accionesSeguimiento(ASIGNADO, ROL.GERENTE, s)).toEqual([]);
    expect(accionesSeguimiento(ASIGNADO, null, s)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Ejemplos XML de los contratos: validan contra su XSD y la app los sabe leer
// ---------------------------------------------------------------------------------------------

describe.each([
  [PROMO_MD, XSD.promotion],
  [WF_MD, XSD.workflow],
])('ejemplos XML de %s', (md, xsd) => {
  // `<response>` es el health (health.xsd), no este XSD.
  const ejemplos = ejemplosXmlDelContrato(md).filter((e) => e.raiz !== 'response');

  it('el contrato trae ejemplos XML', () => {
    expect(ejemplos.length).toBeGreaterThanOrEqual(5);
  });

  it.each(ejemplos.map((e, i) => [`#${i} <${e.raiz}>`, e.xml]))('%s valida contra el XSD', async (_nombre, xml) => {
    expect(await erroresXsd(xml, xsd)).toEqual([]);
  });
});

describe('parsers de promotion-service con los ejemplos del contrato', () => {
  it('lista (status pendiente, sin validity nula ni campos de otro tipo)', () => {
    const { promociones, total } = parsePromociones(delContrato(PROMO_MD, 'promocionListResponse', NAMESPACE.promotion));
    expect(total).toBe(1);
    expect(promociones[0]).toMatchObject({
      type: 'descuento_porcentual',
      discountPct: 10,
      zoneId: 'f2670df2-6c1a-4b8e-9d3f-7a5b2c1e0d44',
      storeId: null,
      packPrice: null,
      status: 'pendiente',
      validity: 'programada',
    });
    expect(camposDelTipo(promociones[0])).toBe('10 % de descuento');
  });

  it('aprobada (resolvedBy y resolvedAt)', () => {
    const p = parsePromocion(delContrato(PROMO_MD, 'promocionResponse', NAMESPACE.promotion));
    expect(p).toMatchObject({ status: 'aprobada', resolvedBy: '3b4c5d6e-7f80-4b9c-8d1e-2f3a4b5c6d7e', rejectionReason: null });
  });

  it('precio unitario del caso de control (paquete 3 por $80: 26.67 MXN/kg, ahorro 11.11 %)', () => {
    const u = parsePrecioUnitario(delContrato(PROMO_MD, 'precioUnitarioResponse', NAMESPACE.promotion, 0));
    expect(u).toMatchObject({ baseUnit: 'kg', disponible: true, savingsPct: 11.11 });
    expect(u.regular).toMatchObject({ disponible: true, price: 30, unitPrice: 30 });
    expect(u.promotional).toEqual({ purchasePrice: 80, items: 3, contentBase: 3, unitPrice: 26.67 });
  });

  it('precio unitario no disponible: sin promocional ni ahorro (nunca 0)', () => {
    const u = parsePrecioUnitario(delContrato(PROMO_MD, 'precioUnitarioResponse', NAMESPACE.promotion, 1));
    expect(u.disponible).toBe(false);
    expect(u.motivo).toMatch(/no tiene precio vigente/);
    expect(u.promotional).toBeNull();
    expect(u.savingsPct).toBeNull();
    expect(u.regular).toMatchObject({ disponible: false, price: null, unitPrice: null });
  });

  it('comparación: de la más barata por unidad a la más cara (tamaño 25 → paquete 26.67 → descuento 27)', () => {
    const c = parseComparacion(delContrato(PROMO_MD, 'comparacionPromocionesResponse', NAMESPACE.promotion));
    expect(c.filas.map((f) => [f.type, f.unitPrice])).toEqual([
      ['tamano_empaque', 25],
      ['paquete', 26.67],
      ['descuento_porcentual', 27],
    ]);
  });

  it('comparación: se reordena aunque llegue desordenada, y las no disponibles van al final', () => {
    const fila = (id: string, unitPrice: number | null, disponible = true) => ({
      promotionId: id, type: 't', presentationId: 'p', status: 'aprobada', disponible, unitPrice, regularUnitPrice: null, savingsPct: null, motivo: null,
    });
    expect(ordenarComparacion([fila('c', 27), fila('x', null, false), fila('a', 25), fila('b', 26.67)]).map((f) => f.promotionId)).toEqual([
      'a', 'b', 'c', 'x',
    ]);
  });

  it('rechazada (fixture): sin validity y con motivo; tamaño de empaque en palabras', () => {
    const r = parsePromocion(exigirRaiz(leerXml(fixture('promotion-rechazada.xml')), 'promocionResponse', NAMESPACE.promotion));
    expect(r).toMatchObject({ status: 'rechazada', validity: null });
    expect(r.rejectionReason).toMatch(/regreso a clases/);
    const t = parsePromocion(exigirRaiz(leerXml(fixture('promotion-tamano.xml')), 'promocionResponse', NAMESPACE.promotion));
    expect(camposDelTipo(t)).toBe('1,200 g por $30.00');
  });

  it('comparar: de 2 a 10 y del mismo producto', () => {
    const p = (productId: string) => ({ productId }) as any;
    expect(motivoNoComparable([p('a')])).toMatch(/al menos 2/);
    expect(motivoNoComparable([p('a'), p('b')])).toMatch(/mismo producto/);
    expect(motivoNoComparable(Array.from({ length: 11 }, () => p('a')))).toMatch(/máximo 10/);
    expect(motivoNoComparable([p('a'), p('a')])).toBeNull();
  });
});

describe('parsers de recommendations-workflow-service con los ejemplos del contrato', () => {
  it('lista', () => {
    const { seguimientos, total } = parseSeguimientos(delContrato(WF_MD, 'seguimientoListResponse', NAMESPACE.workflow));
    expect(total).toBe(1);
    expect(seguimientos[0]).toMatchObject({ status: 'asignada', assigneeUserId: ASIGNADO, dueDate: '2026-11-15', evaluation: null });
  });

  it('evaluada: métrica, periodos, valores y variación (caso de control −9.09 %)', () => {
    const s = parseSeguimiento(delContrato(WF_MD, 'seguimientoResponse', NAMESPACE.workflow));
    expect(s.status).toBe('evaluada');
    expect(s.evaluation).toMatchObject({
      metric: 'precio_unitario',
      unit: 'MXN/kg',
      before: { from: '2026-10-02', to: '2026-10-31', value: 27.5 },
      after: { from: '2026-11-01', to: '2026-11-30', value: 25 },
      variationPct: -9.09,
    });
    expect(s.evaluation?.scope.storeId).toBeNull();
    expect(indicePaso(s.status)).toBe(3);
  });

  it('historial: actor, fecha y estado de auditoría y aviso', () => {
    const h = parseHistorial(delContrato(WF_MD, 'historialSeguimientoResponse', NAMESPACE.workflow));
    expect(h.eventos).toHaveLength(2);
    expect(h.eventos[0]).toMatchObject({ event: 'asignada', fromStatus: null, toStatus: 'asignada', audit: 'enviado' });
    expect(h.eventos[1]).toMatchObject({ event: 'iniciada', fromStatus: 'asignada', actorId: ASIGNADO, notification: 'fallido' });
  });

  it('línea de pasos', () => {
    expect(['asignada', 'en_implementacion', 'implementada', 'evaluada'].map(indicePaso)).toEqual([0, 1, 2, 3]);
    expect(indicePaso('aprobada')).toBe(-1);
  });
});

describe('fixtures nuevas: válidas contra el XSD', () => {
  it.each([
    ['promotion-rechazada.xml', XSD.promotion],
    ['promotion-tamano.xml', XSD.promotion],
    ['promotion-error-409-vencida.xml', XSD.promotion],
    ['workflow-error-409.xml', XSD.workflow],
    ['workflow-en-implementacion.xml', XSD.workflow],
    ['catalog-stores.xml', XSD.catalog],
  ])('%s', async (archivo, xsd) => {
    expect(await erroresXsd(fixture(archivo), xsd)).toEqual([]);
  });

  it('tiendas de catalog-service', () => {
    const { tiendas } = parseStorePage(exigirRaiz(leerXml(fixture('catalog-stores.xml')), 'storeListResponse', NAMESPACE.catalog));
    expect(tiendas[0]).toMatchObject({ nombre: 'Abarrotes Constitución', zonaNombre: 'Zona Centro', activo: true });
  });
});

// ---------------------------------------------------------------------------------------------
// Cuerpos XML que arma la app
// ---------------------------------------------------------------------------------------------

describe('cuerpos XML que arma la app: validan contra su XSD', () => {
  it('rechazoPromocionRequest', async () => {
    const xml = construirXml('rechazoPromocionRequest', NAMESPACE.promotion, cuerpoRechazo('  Se encima con la campaña de regreso a clases.  '));
    expect(await erroresXsd(xml, XSD.promotion)).toEqual([]);
    expect(xml).toContain('<reason>Se encima con la campaña de regreso a clases.</reason>');
  });

  it('implementacionRequest, con y sin fecha', async () => {
    const con = construirXml('implementacionRequest', NAMESPACE.workflow, cuerpoImplementacion({ implementedOn: '2026-11-01', note: 'Precio bajado de $27.50 a $25.00.' }));
    const sin = construirXml('implementacionRequest', NAMESPACE.workflow, cuerpoImplementacion({ note: 'Precio bajado de $27.50 a $25.00.' }));
    expect(await erroresXsd(con, XSD.workflow)).toEqual([]);
    expect(await erroresXsd(sin, XSD.workflow)).toEqual([]);
    expect(sin).not.toContain('implementedOn');
  });

  it('simulacionPrecioRequest (precio con 2 decimales)', async () => {
    const xml = construirXml('simulacionPrecioRequest', NAMESPACE.decision, cuerpoSimulacionPrecio({ presentationId: 'p-1', zoneId: 'z-1', newPrice: 25.5 }));
    expect(await erroresXsd(xml, XSD.decision)).toEqual([]);
    expect(xml).toContain('<newPrice>25.50</newPrice>');
  });

  it('simulacionPresentacionRequest, con lista de presentaciones y solo con el producto', async () => {
    const con = construirXml('simulacionPresentacionRequest', NAMESPACE.decision, cuerpoSimulacionEmpaque({ productId: 'p', zoneId: 'z', presentationIds: ['a', 'b', 'c'] }));
    const sin = construirXml('simulacionPresentacionRequest', NAMESPACE.decision, cuerpoSimulacionEmpaque({ productId: 'p' }));
    expect(await erroresXsd(con, XSD.decision)).toEqual([]);
    expect(await erroresXsd(sin, XSD.decision)).toEqual([]);
    expect(con).toMatch(/<presentationIds>\s*<item>a<\/item>\s*<item>b<\/item>\s*<item>c<\/item>\s*<\/presentationIds>/);
  });

  it('el XSD rechaza un cuerpo con raíz o namespace equivocados, o un motivo corto', async () => {
    expect((await erroresXsd(construirXml('rechazoRequest', NAMESPACE.promotion, cuerpoRechazo('Motivo suficientemente largo')), XSD.promotion)).length).toBeGreaterThan(0);
    expect((await erroresXsd(construirXml('rechazoPromocionRequest', NAMESPACE.workflow, cuerpoRechazo('Motivo suficientemente largo')), XSD.promotion)).length).toBeGreaterThan(0);
    expect((await erroresXsd(construirXml('rechazoPromocionRequest', NAMESPACE.promotion, cuerpoRechazo('corto')), XSD.promotion)).length).toBeGreaterThan(0);
    expect((await erroresXsd(construirXml('implementacionRequest', NAMESPACE.workflow, { note: 'Nota de prueba larga', implementedOn: '2026-11-01' }), XSD.workflow)).length).toBeGreaterThan(0); // orden del xs:sequence
  });
});

// ---------------------------------------------------------------------------------------------
// Cliente HTTP con un adaptador falso
// ---------------------------------------------------------------------------------------------

interface Respuesta {
  status: number;
  tipo?: string;
  cuerpo?: string;
}

let enviado: InternalAxiosRequestConfig[] = [];
let siguiente: Respuesta = { status: 200 };
const adaptadorOriginal = http.defaults.adapter;

const falso: AxiosAdapter = async (config) => {
  enviado.push(config);
  const r = { data: siguiente.cuerpo ?? '', status: siguiente.status, statusText: '', headers: { 'content-type': siguiente.tipo ?? '' }, config };
  if (r.status >= 400) {
    const e: any = new Error(`Request failed with status code ${r.status}`);
    e.isAxiosError = true;
    e.config = config;
    e.response = r;
    throw e;
  }
  return r;
};

const xmlOk = (cuerpo: string, status = 200): Respuesta => ({ status, tipo: 'application/xml; charset=utf-8', cuerpo });
const ejemplo = (md: string, raiz: string, n = 0) => ejemplosXmlDelContrato(md).filter((e) => e.raiz === raiz)[n].xml;

describe('cliente HTTP: lo que se manda y cómo se leen las respuestas', () => {
  beforeAll(() => {
    http.defaults.adapter = falso;
    vi.stubEnv('VITE_PROMOTION_URL', 'http://promo.prueba/');
    vi.stubEnv('VITE_WORKFLOW_URL', 'http://wf.prueba/');
    vi.stubEnv('VITE_DECISION_URL', 'http://dec.prueba/');
  });
  afterAll(() => {
    http.defaults.adapter = adaptadorOriginal;
    vi.unstubAllEnvs();
  });
  beforeEach(() => {
    enviado = [];
  });

  it('rechazar: PATCH con cuerpo XML rechazoPromocionRequest que valida contra el XSD', async () => {
    siguiente = xmlOk(fixture('promotion-rechazada.xml'));
    const p = await rechazarPromocion('3e5f7a91-2b4c-4d6e-8f10-a2b3c4d5e6f7', 'Se encima con la campaña de regreso a clases.');
    expect(p.status).toBe('rechazada');
    const req = enviado[0];
    expect(req.method).toBe('patch');
    expect(req.baseURL).toBe('http://promo.prueba/');
    expect(req.url).toBe('v1/promotions/3e5f7a91-2b4c-4d6e-8f10-a2b3c4d5e6f7/reject');
    expect(req.headers['Content-Type']).toBe('application/xml');
    expect(req.headers.Accept).toBe('application/xml');
    expect(req.data).toContain('<rechazoPromocionRequest xmlns="promotion/v1">');
    expect(await erroresXsd(req.data, XSD.promotion)).toEqual([]);
  });

  it('aprobar: PATCH sin cuerpo', async () => {
    siguiente = xmlOk(ejemplo(PROMO_MD, 'promocionResponse'));
    await aprobarPromocion('3e5f7a91-2b4c-4d6e-8f10-a2b3c4d5e6f7');
    expect(enviado[0].url).toBe('v1/promotions/3e5f7a91-2b4c-4d6e-8f10-a2b3c4d5e6f7/approve');
    expect(enviado[0].data).toBeUndefined();
  });

  it('comparar: ids separados por coma y storeId', async () => {
    siguiente = xmlOk(ejemplo(PROMO_MD, 'comparacionPromocionesResponse'));
    await compararPromociones(['a', 'b'], 's');
    expect(enviado[0].params).toEqual({ ids: 'a,b', storeId: 's' });
  });

  it('marcar implementada: PATCH con cuerpo XML implementacionRequest que valida contra el XSD', async () => {
    siguiente = xmlOk(ejemplo(WF_MD, 'seguimientoResponse'));
    await marcarImplementada('6b7c8d9e-0f1a-4b2c-8d3e-4f5a6b7c8d9e', { implementedOn: '2026-11-01', note: 'Precio del arroz bajado a $25.00.' });
    const req = enviado[0];
    expect(req.url).toBe('v1/workflow/assignments/6b7c8d9e-0f1a-4b2c-8d3e-4f5a6b7c8d9e/implement');
    expect(req.headers['Content-Type']).toBe('application/xml');
    expect(req.data).toContain('<implementacionRequest xmlns="workflow/v1">');
    expect(await erroresXsd(req.data, XSD.workflow)).toEqual([]);
  });

  it('"Mis seguimientos" manda mine=true (contrato §9)', async () => {
    siguiente = xmlOk(ejemplo(WF_MD, 'seguimientoListResponse'));
    await listarSeguimientos({ mine: true });
    expect(enviado[0].params).toMatchObject({ mine: 'true' });
    await listarSeguimientos({});
    expect(enviado[1].params).not.toHaveProperty('mine');
  });

  it('simulación de precio y de empaques: POST con cuerpo XML que valida contra el XSD de decision', async () => {
    siguiente = xmlOk(fixture('decision-price.xml'), 201);
    await simularPrecio({ presentationId: 'p-1', zoneId: 'z-1', newPrice: 27.5 });
    siguiente = xmlOk(fixture('decision-presentation.xml'), 201);
    await simularEmpaque({ productId: 'prod-1', presentationIds: ['a', 'b', 'c'] });
    for (const [i, raiz] of [[0, 'simulacionPrecioRequest'], [1, 'simulacionPresentacionRequest']] as const) {
      const req = enviado[i];
      expect(req.headers['Content-Type']).toBe('application/xml');
      expect(req.data).toContain(`<${raiz} xmlns="decision/v1">`);
      expect(await erroresXsd(req.data, XSD.decision)).toEqual([]);
    }
  });

  it('una respuesta con la raíz o el namespace de otro servicio se rechaza', async () => {
    siguiente = xmlOk(ejemplo(WF_MD, 'seguimientoResponse'));
    await expect(pedir({ servicio: 'promotion', ruta: 'x', raiz: 'promocionResponse' })).rejects.toMatchObject({ code: 'XML_FUERA_DE_CONTRATO' });
    siguiente = xmlOk(ejemplo(PROMO_MD, 'promocionResponse').replace('xmlns="promotion/v1"', 'xmlns="workflow/v1"'));
    await expect(pedir({ servicio: 'promotion', ruta: 'x', raiz: 'promocionResponse' })).rejects.toThrow(/namespace/);
  });

  it('409 al aprobar una ya resuelta (XML del contrato): mensaje claro', async () => {
    siguiente = xmlOk(ejemplo(PROMO_MD, 'error'), 409);
    const e = await aprobarPromocion('3e5f7a91-2b4c-4d6e-8f10-a2b3c4d5e6f7').catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(mensajeConflictoPromocion(e)).toMatch(/^Ya resuelta: La promoción ya está aprobada/);
  });

  it('409 al aprobar una vencida: mensaje de ya vencida', () => {
    const e = errorDeRespuesta(409, 'application/xml', fixture('promotion-error-409-vencida.xml'), 'promotion-service');
    expect(mensajeConflictoPromocion(e)).toMatch(/^Ya vencida: .*2026-11-15/);
    expect(mensajeConflictoPromocion(new ApiError('x', 400, 'VALIDATION_ERROR'))).toBeNull();
  });

  it('409 de seguimiento (salto de estado): se muestra el estado actual que manda details', async () => {
    siguiente = xmlOk(fixture('workflow-error-409.xml'), 409);
    const e = await marcarImplementada('6b7c8d9e-0f1a-4b2c-8d3e-4f5a6b7c8d9e', { note: 'Nota suficientemente larga.' }).catch((x) => x);
    expect(estadoActualDe409(e)).toBe('asignada');
    expect(mensajeConflictoSeguimiento(e)).toBe('Transición fuera de orden. Estado actual: Asignada. Se recargó el seguimiento.');
    // Mismo error en JSON (como lo muestra el contrato) también se entiende.
    const json = errorDeRespuesta(
      409,
      'application/json',
      JSON.stringify({ statusCode: 409, message: 'Transición fuera de orden.', code: 'CONFLICT', details: ['estado actual: en_implementacion'], path: '/x', timestamp: 't' }),
    );
    expect(estadoActualDe409(json)).toBe('en_implementacion');
  });
});
