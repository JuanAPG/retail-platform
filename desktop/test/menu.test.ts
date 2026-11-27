import { describe, expect, it } from 'vitest';
import { ROL, menuParaRol, puede, puedeVerRuta, rolAdmitido } from '../src/config/menu';

/** D-31 (matriz §4.2), Matriz §3/§3.2 y contratos. La UI refleja; el servidor vuelve a revisar. */

const DENTRO = [ROL.ANALISTA, ROL.RESPONSABLE_PRECIOS, ROL.PLANEADOR];
const FUERA = [ROL.ADMINISTRADOR, ROL.GERENTE, ROL.AUDITOR, ROL.PROVEEDOR, ROL.INVESTIGADOR];

const rutas = (rol: string) => menuParaRol(rol).map((m) => m.path);

describe('acceso a la app (D-31)', () => {
  it.each(DENTRO)('AUTORIZADO: %s entra al escritorio', (rol) => {
    expect(rolAdmitido(rol)).toBe(true);
    expect(menuParaRol(rol).length).toBeGreaterThan(0);
  });

  it.each(FUERA)('DENEGADO: %s no entra (acceso no permitido) y no tiene menú', (rol) => {
    expect(rolAdmitido(rol)).toBe(false);
    expect(menuParaRol(rol)).toEqual([]);
  });

  it('sin rol o con un rol escrito distinto (sin acento) no entra', () => {
    expect(rolAdmitido(null)).toBe(false);
    expect(rolAdmitido('Analista Comercial')).toBe(false);
    expect(rolAdmitido('Gerente de categoria')).toBe(false);
  });
});

describe('menú por rol', () => {
  it('Analista comercial: todas las secciones, incluida Importar ventas', () => {
    expect(rutas(ROL.ANALISTA)).toEqual([
      '/zonas', '/asociacion', '/elasticidad', '/segmentos', '/simulacion', '/ventas', '/promociones', '/seguimiento', '/reportes',
    ]);
  });

  it('Responsable de precios y Planeador: todo menos Importar ventas (solo Analista, contrato 3111)', () => {
    for (const rol of [ROL.RESPONSABLE_PRECIOS, ROL.PLANEADOR]) {
      expect(rutas(rol)).not.toContain('/ventas');
      expect(rutas(rol)).toContain('/elasticidad');
      expect(rutas(rol)).toContain('/simulacion');
    }
  });

  it('cada sección dice qué servicio la alimenta', () => {
    for (const item of menuParaRol(ROL.ANALISTA)) expect(item.servicio).toMatch(/service|core/);
    expect(menuParaRol(ROL.ANALISTA).find((m) => m.path === '/segmentos')?.servicio).toBe('income-segmentation-service');
    expect(menuParaRol(ROL.ANALISTA).find((m) => m.path === '/ventas')?.servicio).toBe('transactions-ingestion-service');
  });

  it('ruta directa: AUTORIZADO Analista en /ventas; DENEGADO Planeador en /ventas y Administrador en /zonas', () => {
    expect(puedeVerRuta(ROL.ANALISTA, '/ventas')).toBe(true);
    expect(puedeVerRuta(ROL.PLANEADOR, '/ventas')).toBe(false);
    expect(puedeVerRuta(ROL.ADMINISTRADOR, '/zonas')).toBe(false);
  });
});

describe('acciones dentro de las pantallas', () => {
  it('Elasticidad: AUTORIZADO calcular el Responsable de precios; DENEGADO el Analista (caso de control de D-31)', () => {
    expect(puede(ROL.RESPONSABLE_PRECIOS, 'calcularElasticidad')).toBe(true);
    expect(puede(ROL.ANALISTA, 'calcularElasticidad')).toBe(false);
    expect(puede(ROL.PLANEADOR, 'calcularElasticidad')).toBe(false);
  });

  it('Simulación: AUTORIZADO el Planeador; DENEGADO Analista y Responsable (solo ven escenarios)', () => {
    expect(puede(ROL.PLANEADOR, 'simular')).toBe(true);
    expect(puede(ROL.ANALISTA, 'simular')).toBe(false);
    expect(puede(ROL.RESPONSABLE_PRECIOS, 'simular')).toBe(false);
  });

  it('Asociaciones, segmentos e importar ventas: solo el Analista comercial', () => {
    for (const accion of ['ejecutarAsociacion', 'editarSegmentos', 'importarVentas'] as const) {
      expect(puede(ROL.ANALISTA, accion)).toBe(true);
      expect(puede(ROL.RESPONSABLE_PRECIOS, accion)).toBe(false);
      expect(puede(ROL.PLANEADOR, accion)).toBe(false);
      expect(puede(ROL.ADMINISTRADOR, accion)).toBe(false);
    }
  });
});
