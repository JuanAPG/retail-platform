/**
 * D-28: el `Investigador de mercado` (app móvil) levanta precios observados y
 * nada más en pricing-service. Matriz §3, M08: **P** en Precios (propone) y
 * **–** en Comparación de precios.
 *
 * La observación nace pendiente y la aprueba el Responsable de precios (D-16),
 * que sigue siendo el único que aprueba (D1).
 */
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { CAPTURAN_OBSERVACIONES, PERFILES_INTERNOS, ROL, VEN_OBSERVACIONES } from '../common/roles';
import { PriceObservationsController } from '../price-observations/price-observations.controller';
import { PriceProposalsController } from '../price-proposals/price-proposals.controller';
import { PricesController } from '../prices/prices.controller';

const rolesDe = (handler: unknown): string[] | undefined =>
  new Reflector().get<string[]>(ROLES_KEY, handler as () => unknown);

describe('Investigador de mercado: lo único que abre D-28 en pricing', () => {
  it('POST /v1/price-observations lo acepta, sin sacar a quien ya capturaba', () => {
    const roles = rolesDe(PriceObservationsController.prototype.create);
    expect(roles).toContain(ROL.INVESTIGADOR);
    expect(roles).toContain(ROL.ANALISTA);
    expect(roles).toContain(ROL.RESPONSABLE_PRECIOS);
  });

  it('la constante de captura es la única que lo nombra', () => {
    expect(CAPTURAN_OBSERVACIONES as readonly string[]).toContain(ROL.INVESTIGADOR);
    expect(VEN_OBSERVACIONES as readonly string[]).not.toContain(ROL.INVESTIGADOR);
    expect(PERFILES_INTERNOS as readonly string[]).not.toContain(ROL.INVESTIGADOR);
  });
});

describe('Investigador de mercado: lo que D-28 NO le da en pricing', () => {
  const cerradas: Array<[string, unknown]> = [
    // Un precio directo lo pone solo el Responsable de precios (D1).
    ['POST /v1/prices', PricesController.prototype.create],
    ['GET /v1/prices/history', PricesController.prototype.findHistory],
    ['GET /v1/prices/current', PricesController.prototype.findCurrent],
    ['GET /v1/prices/series', PricesController.prototype.findSeries],
    // §3, M08 "Comparación de precios": – para el Investigador.
    ['GET /v1/prices/compare-zones', PricesController.prototype.compareAcrossZones],
    // Las propuestas del Proveedor son otro flujo (§5.2).
    ['POST /v1/price-proposals', PriceProposalsController.prototype.create],
    ['GET /v1/price-proposals', PriceProposalsController.prototype.findAll],
    ['PATCH /v1/price-proposals/:id/approve', PriceProposalsController.prototype.approve],
    // Aprobar o rechazar una observación es del Responsable de precios (D1).
    ['PATCH /v1/price-observations/:id/approve', PriceObservationsController.prototype.approve],
    ['PATCH /v1/price-observations/:id/reject', PriceObservationsController.prototype.reject],
    // No lee la bandeja: D-28 le da alta, no lectura.
    ['GET /v1/price-observations', PriceObservationsController.prototype.findAll],
  ];

  it.each(cerradas)('%s sigue cerrada al Investigador', (_ruta, handler) => {
    const roles = rolesDe(handler);
    expect(roles).toBeDefined();
    expect(roles).not.toContain(ROL.INVESTIGADOR);
  });

  it('el Responsable de precios sigue siendo el único que aprueba (D1)', () => {
    expect(rolesDe(PriceObservationsController.prototype.approve)).toEqual([ROL.RESPONSABLE_PRECIOS]);
    expect(rolesDe(PriceProposalsController.prototype.approve)).toEqual([ROL.RESPONSABLE_PRECIOS]);
  });
});
