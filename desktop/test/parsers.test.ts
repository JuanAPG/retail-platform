import { describe, expect, it } from 'vitest';
import { parseLogin, parseValidate } from '../src/api/authApi';
import {
  parseElasticityCalculate,
  parseElasticityChart,
  parseElasticityCurrent,
  parseRunDetail,
  parseRules,
} from '../src/api/algorithmsParsers';
import { parseComparison, parseProductPage, parseZonePage } from '../src/api/catalogParsers';
import { parseEscenarios, parseSimulacionEmpaque, parseSimulacionPrecio } from '../src/api/decisionApi';
import { parseReporte } from '../src/api/documentsApi';
import { parseFilas, parseLote, parseLotes, revisarXmlVentas } from '../src/api/ingestionApi';
import { parseSegmentPage, parseSegmentVersion } from '../src/api/segmentsApi';
import { NAMESPACE, XmlInvalidoError, asList, construirXml, errorDesdeXml, exigirRaiz, leerXml } from '../src/api/xml';
import { fixture } from './apoyo';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { EJEMPLOS_CONTRATO } from './apoyo';

/** Lee el fixture como lo hace `pedir`: XML → raíz y namespace del contrato → contenido. */
const raiz = (archivo: string, nombre: string, ns: string) => exigirRaiz(leerXml(fixture(archivo)), nombre, ns);

describe('lectura de XML en ejecución (raíz, namespace, error)', () => {
  it('acepta la raíz y el namespace del contrato', () => {
    const doc = leerXml(fixture('auth-login.xml'));
    expect(doc.raiz).toBe('loginResponse');
    expect(doc.namespace).toBe('auth/v1');
  });

  it('rechaza otra raíz', () => {
    expect(() => raiz('auth-login.xml', 'refreshResponse', NAMESPACE.auth)).toThrow(XmlInvalidoError);
  });

  it('rechaza otro namespace (p. ej. el <response> sin namespace de antes)', () => {
    const viejo = '<?xml version="1.0"?><response><accessToken>a</accessToken></response>';
    expect(() => exigirRaiz(leerXml(viejo), 'loginResponse', NAMESPACE.auth)).toThrow(/Se esperaba <loginResponse>/);
    const sinNs = fixture('auth-login.xml').replace(' xmlns="auth/v1"', '');
    expect(() => exigirRaiz(leerXml(sinNs), 'loginResponse', NAMESPACE.auth)).toThrow(/namespace/);
  });

  it('reconoce un namespace con prefijo', () => {
    const doc = leerXml('<a:loginResponse xmlns:a="auth/v1"><a:accessToken>x</a:accessToken></a:loginResponse>');
    expect(doc).toMatchObject({ raiz: 'loginResponse', namespace: 'auth/v1' });
    expect(doc.cuerpo.accessToken).toBe('x');
  });

  it('rechaza DOCTYPE/ENTITY y XML mal formado', () => {
    expect(() => leerXml('<!DOCTYPE x [<!ENTITY e "x">]><x>&e;</x>')).toThrow(/DOCTYPE/);
    expect(() => leerXml('no es xml')).toThrow(XmlInvalidoError);
  });

  it('lee un <error> con detalle y exige sus campos', () => {
    const e = errorDesdeXml(leerXml(fixture('segmentation-error-400.xml')));
    expect(e).toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR', details: ['incomeRangeMin se encima con ING_2'] });
    const incompleto = fixture('auth-error-401.xml').replace('<code>UNAUTHORIZED</code>', '');
    expect(() => errorDesdeXml(leerXml(incompleto))).toThrow(/code/);
  });

  it('no convierte textos numéricos (un SKU "007" sigue siendo "007")', () => {
    const p = parseProductPage(raiz('catalog-products.xml', 'productListResponse', NAMESPACE.catalog));
    expect(p.productos[0].sku).toBe('007');
  });

  it('construirXml: raíz con namespace, listas como <item>, sin nulos, texto escapado', () => {
    const xml = construirXml('x', 'n/v1', { a: 'uno & dos', b: null, lista: ['p', 'q'] });
    const doc = leerXml(xml);
    expect(doc).toMatchObject({ raiz: 'x', namespace: 'n/v1' });
    expect(doc.cuerpo.a).toBe('uno & dos');
    expect(doc.cuerpo.b).toBeUndefined();
    expect(asList(doc.cuerpo.lista.item)).toEqual(['p', 'q']);
  });
});

describe('parsers por servicio', () => {
  it('auth: loginResponse y validateResponse', () => {
    const l = parseLogin(raiz('auth-login.xml', 'loginResponse', NAMESPACE.auth));
    expect(l.usuario).toMatchObject({ rol: 'Analista comercial', rolId: 2, activo: true });
    expect(l.accessToken).toBe('aaa.bbb.ccc');
    expect(parseValidate(raiz('auth-validate.xml', 'validateResponse', NAMESPACE.auth)).user?.rol).toBe('Analista comercial');
  });

  it('catalog: zonas y comparación (indicadores sin calcular = null)', () => {
    const z = parseZonePage(raiz('catalog-zones.xml', 'zoneListResponse', NAMESPACE.catalog));
    expect(z.zones[0]).toMatchObject({ nombre: 'Zona Centro', municipio: 'Monterrey', activo: true });
    const c = parseComparison(raiz('catalog-compare.xml', 'zoneCompareResponse', NAMESPACE.catalog));
    expect(c[0].estimatedIncome).toBe(18500.5);
    expect(c[1]).toMatchObject({ classification: null, estimatedIncome: null, availability: null });
  });

  it('algorithms: FP-Growth, detalle de corrida con su algoritmo y supuestos en orden', () => {
    const reglas = parseRules(raiz('algorithms-fpgrowth.xml', 'fpgrowthRunResponse', NAMESPACE.algorithms));
    expect(reglas).toHaveLength(1);
    expect(reglas[0]).toMatchObject({ antecedente: ['Leche entera'], consecuente: ['Pan de caja'], lift: 1.8, support: 0.24 });
    const run = parseRunDetail(raiz('algorithms-run.xml', 'runResponse', NAMESPACE.algorithms));
    expect(run.algoritmo).toBe('fpgrowth');
    expect(run.errorMessage).toBeNull();
    expect(run.assumptions[0]).toBe('Una canasta = una transacción.');
    expect(run.filters[0].dimension).toBe('zona');
  });

  it('algorithms: elasticidad (nacional = zoneId null; sin datos = null, nunca 0 ni NaN)', () => {
    const calc = parseElasticityCalculate(raiz('algorithms-elasticity-calculate.xml', 'elasticityCalculateResponse', NAMESPACE.algorithms));
    expect(calc.results[0]).toMatchObject({ zoneId: null, zoneName: 'Nacional', value: -1.35, classification: 'elastic' });
    expect(calc.insufficient[0].reason).toMatch(/Un solo precio/);
    const chart = parseElasticityChart(raiz('algorithms-elasticity-chart.xml', 'elasticityChartResponse', NAMESPACE.algorithms));
    expect(chart.bars[1]).toMatchObject({ value: null, classification: null, atypical: null, rSquared: null });
    expect(chart.national?.value).toBe(-1.35);
    const vig = parseElasticityCurrent(raiz('algorithms-elasticity-current.xml', 'currentElasticityListResponse', NAMESPACE.algorithms));
    expect(vig.filas[0]).toMatchObject({ classification: 'unitary', outdated: true, rSquared: null });
  });

  it('income-segmentation: segmentos con versión y versiones (sin tope = null)', () => {
    const { segmentos } = parseSegmentPage(raiz('segmentation-segments.xml', 'segmentListResponse', NAMESPACE.segmentation));
    expect(segmentos[0]).toMatchObject({ code: 'ING_1', version: 2, incomeRangeMax: 15000 });
    expect(segmentos[1]).toMatchObject({ incomeRangeMax: null, description: 'Sin tope' });
    const vs = raiz('segmentation-versions.xml', 'segmentVersionListResponse', NAMESPACE.segmentation);
    const versiones = asList(vs.data.item).map(parseSegmentVersion);
    expect(versiones.map((v) => [v.version, v.current])).toEqual([[2, true], [1, false]]);
    expect(versiones[1]).toMatchObject({ validTo: '2026-10-30T16:00:00.000Z', changeReason: null });
  });

  it('decision: caso de control D-01 (1,000 → 826, ingreso −9.1 %) y empaques', () => {
    const p = parseSimulacionPrecio(raiz('decision-price.xml', 'simulacionPrecioResponse', NAMESPACE.decision));
    expect(p).toMatchObject({ currentPrice: 25, newPrice: 27.5, elasticity: -2, baseDemand: 1000 });
    expect(Math.round(p.results[0].simulatedValue!)).toBe(826);
    expect(p.results[1].variationPct).toBeCloseTo(-9.1, 1);
    const e = parseSimulacionEmpaque(raiz('decision-presentation.xml', 'simulacionPresentacionResponse', NAMESPACE.decision));
    expect(e.presentations[0].incomeSharePct).toBe(0.15);
    expect(e.presentations[1]).toMatchObject({ priceStatus: 'sin_precio', outlay: null, unitPrice: null });
    expect(e.warnings).toHaveLength(1);
    expect(parseEscenarios(raiz('decision-scenarios.xml', 'simulacionEscenariosResponse', NAMESPACE.decision)).escenarios[0].newPrice).toBe(27.5);
  });

  it('documents: un indicador no disponible queda sin valor y con motivo (D-20, nunca 0)', () => {
    const r = raiz('documents-reports.xml', 'reportListResponse', NAMESPACE.documents);
    const reporte = parseReporte(asList(r.data.item)[0]);
    expect(reporte.secciones[0]).toMatchObject({ disponible: true, valor: '86.4' });
    expect(reporte.secciones[1]).toMatchObject({ disponible: false, valor: null, motivo: 'algorithms-core no respondió en 3 s.' });
  });

  it('ingestion: vista previa, errores por fila y lista vacía', () => {
    const lote = parseLote(raiz('ingestion-import.xml', 'transactionImport', NAMESPACE.ingestion));
    expect(lote).toMatchObject({ state: 'vista_previa', format: 'csv', sizeBytes: 124 });
    expect(lote.counts).toEqual({ valid: 1, repeated: 0, rejected: 1, conflicts: 0, inserted: 0 });
    const { filas } = parseFilas(raiz('ingestion-rows.xml', 'transactionImportRows', NAMESPACE.ingestion));
    expect(filas[1]).toEqual({ row: 2, status: 'rechazada', code: 'PRECIO_INVALIDO', message: 'El precio debe ser mayor que cero.' });
    expect(filas[0].code).toBeNull();
    expect(parseLotes(raiz('ingestion-imports.xml', 'transactionImports', NAMESPACE.ingestion))).toEqual({ lotes: [], total: 0 });
  });

  it('ingestion: revisión local del archivo de ventas XML', () => {
    const bueno = readFileSync(join(EJEMPLOS_CONTRATO, 'ingestion-ventas.xml'), 'utf8');
    expect(revisarXmlVentas(bueno)).toBeNull();
    expect(revisarXmlVentas(bueno.replace('ingestion/v1', 'ventas/v1'))).toMatch(/namespace/);
    expect(revisarXmlVentas(fixture('ingestion-import.xml'))).toMatch(/salesFile/);
    expect(revisarXmlVentas('<!DOCTYPE x><salesFile/>')).toMatch(/DOCTYPE/);
  });
});
