import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { archivoVentasXml } from '../src/api/ingestionApi';
import { NAMESPACE, construirXml } from '../src/api/xml';
import { EN_REVISION, XSD, erroresXsd, fixture, leer } from './apoyo';

/**
 * Validación COMPLETA contra los XSD de docs/contratos (y el de ingesta en revisión), con libxml2.
 * Cubre: las respuestas que la app sabe leer (fixtures), los ejemplos del contrato de ingesta y
 * el XML que la app ARMA y envía.
 */

const RESPUESTAS: Array<[string, string]> = [
  ['auth-login.xml', XSD.auth],
  ['auth-validate.xml', XSD.auth],
  ['auth-error-401.xml', XSD.auth],
  ['catalog-zones.xml', XSD.catalog],
  ['catalog-compare.xml', XSD.catalog],
  ['catalog-products.xml', XSD.catalog],
  ['algorithms-fpgrowth.xml', XSD.algorithms],
  ['algorithms-run.xml', XSD.algorithms],
  ['algorithms-elasticity-calculate.xml', XSD.algorithms],
  ['algorithms-elasticity-chart.xml', XSD.algorithms],
  ['algorithms-elasticity-current.xml', XSD.algorithms],
  ['segmentation-segments.xml', XSD.segmentation],
  ['segmentation-versions.xml', XSD.segmentation],
  ['segmentation-error-400.xml', XSD.segmentation],
  ['decision-price.xml', XSD.decision],
  ['decision-presentation.xml', XSD.decision],
  ['decision-scenarios.xml', XSD.decision],
  ['documents-reports.xml', XSD.documents],
  ['ingestion-import.xml', XSD.ingestion],
  ['ingestion-rows.xml', XSD.ingestion],
  ['ingestion-imports.xml', XSD.ingestion],
  ['ingestion-error-413.xml', XSD.ingestion],
];

describe('respuestas que lee la app: válidas contra el XSD de su servicio', () => {
  it.each(RESPUESTAS)('%s', async (archivo, xsd) => {
    expect(await erroresXsd(fixture(archivo), xsd)).toEqual([]);
  });
});

describe('ejemplos del contrato de ingesta (en revisión, PR #96)', () => {
  it('ingestion-ventas.xml (el ARCHIVO de ventas) valida', async () => {
    expect(await erroresXsd(leer(join(EN_REVISION, 'ejemplos', 'ingestion-ventas.xml')), XSD.ingestion)).toEqual([]);
  });

  it('ingestion-objeto.xml (el MENSAJE de control) valida', async () => {
    expect(await erroresXsd(leer(join(EN_REVISION, 'ejemplos', 'ingestion-objeto.xml')), XSD.ingestion)).toEqual([]);
  });
});

describe('XML que la app arma y envía', () => {
  it('el mensaje objectImport que manda "Importar desde el bucket" valida', async () => {
    const xml = construirXml('objectImport', NAMESPACE.ingestion, {
      objectKey: 'ingestion/incoming/01/demo.csv',
      generation: '1764000000000000',
    });
    expect(await erroresXsd(xml, XSD.ingestion)).toEqual([]);
  });

  it('la plantilla de archivo de ventas (salesFile) valida, con montos de 2 decimales', async () => {
    const xml = archivoVentasXml([
      { folio: 'DEMO-001', fecha: '2026-11-20', tienda: 'MTY-CENTRO', sku: 'SKU-100', presentacion: '500 g', cantidad: 2, precio: 42.5 },
      { folio: 'DEMO-002', fecha: '2026-11-21', tienda: 'MTY & Co <sur>', sku: 'SKU-101', presentacion: '1 L', cantidad: 1.25, precio: 18 },
    ]);
    expect(xml).toContain('<precio>42.50</precio>');
    expect(xml).toContain('MTY &amp; Co &lt;sur&gt;');
    expect(await erroresXsd(xml, XSD.ingestion)).toEqual([]);
  });
});

describe('el validador sí detecta XML fuera de contrato', () => {
  it('namespace equivocado', async () => {
    const xml = fixture('ingestion-import.xml').replace('xmlns="ingestion/v1"', 'xmlns="otro/v1"');
    expect((await erroresXsd(xml, XSD.ingestion)).length).toBeGreaterThan(0);
  });

  it('precio negativo en el archivo de ventas', async () => {
    const xml = leer(join(EN_REVISION, 'ejemplos', 'ingestion-ventas.xml')).replace('<precio>42.50</precio>', '<precio>-3</precio>');
    expect((await erroresXsd(xml, XSD.ingestion)).length).toBeGreaterThan(0);
  });

  it('falta un elemento obligatorio (segmento sin version)', async () => {
    const xml = fixture('segmentation-segments.xml').replace('<version>2</version>', '');
    expect((await erroresXsd(xml, XSD.segmentation)).length).toBeGreaterThan(0);
  });

  it('un <error> sin code', async () => {
    const xml = fixture('auth-error-401.xml').replace('<code>UNAUTHORIZED</code>', '');
    expect((await erroresXsd(xml, XSD.auth)).length).toBeGreaterThan(0);
  });
});
