/**
 * D-28: el `Investigador de mercado` (app móvil) lee tiendas, zonas, productos
 * y presentaciones, y NADA MÁS en este servicio. Matriz §3: M02 L, M03 L,
 * M04 L (la P del alta con origen campo es D-32 y todavía no existe aquí).
 *
 * Se lee el `@Roles` real del controlador para que el día que alguien lo
 * cambie, la prueba truene en vez de abrirse un hueco en silencio.
 */
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { PERFILES_INTERNOS, ROL } from '../common/roles';
import { ProductsController } from '../products/products.controller';
import { StoresController } from '../stores/stores.controller';
import { ZonesController } from '../zones/zones.controller';

/** Roles que exige una ruta, leídos del `@Roles` de su handler. */
const rolesDe = (handler: unknown): string[] | undefined =>
  new Reflector().get<string[]>(ROLES_KEY, handler as () => unknown);

describe('Investigador de mercado: lecturas que abre D-28', () => {
  const lecturas: Array<[string, unknown]> = [
    ['GET /v1/stores', StoresController.prototype.findAll],
    ['GET /v1/stores/:id', StoresController.prototype.findOne],
    ['GET /v1/zones', ZonesController.prototype.findAll],
    ['GET /v1/zones/:id', ZonesController.prototype.findOne],
    ['GET /v1/products/:id', ProductsController.prototype.findOne],
    ['GET /v1/products/:id/presentations', ProductsController.prototype.findPresentations],
  ];

  it.each(lecturas)('%s acepta al Investigador sin quitarle nada a los perfiles internos', (_ruta, handler) => {
    const roles = rolesDe(handler);
    expect(roles).toContain(ROL.INVESTIGADOR);
    for (const interno of PERFILES_INTERNOS) expect(roles).toContain(interno);
  });

  it('GET /v1/products no declara @Roles: queda abierta a cualquier sesión válida', () => {
    // No es un descuido: el Proveedor entra y el servicio le filtra lo suyo.
    // El Investigador entra por la misma puerta y ve solo los activos.
    expect(rolesDe(ProductsController.prototype.findAll)).toBeUndefined();
  });
});

describe('Investigador de mercado: lo que D-28 NO le da en catalog-service', () => {
  const cerradas: Array<[string, unknown]> = [
    ['POST /v1/stores', StoresController.prototype.create],
    ['PATCH /v1/stores/:id', StoresController.prototype.update],
    ['DELETE /v1/stores/:id', StoresController.prototype.remove],
    ['POST /v1/zones', ZonesController.prototype.create],
    ['PATCH /v1/zones/:id', ZonesController.prototype.update],
    ['DELETE /v1/zones/:id', ZonesController.prototype.remove],
    ['POST /v1/products', ProductsController.prototype.create],
    ['PATCH /v1/products/:id', ProductsController.prototype.update],
    ['DELETE /v1/products/:id', ProductsController.prototype.remove],
    // D-32 (propuesta de producto con origen campo) todavía no existe: hoy
    // proponer sigue siendo exclusivo del Proveedor.
    ['POST /v1/products/proposals', ProductsController.prototype.createProposal],
    // Pendientes y rechazados son solo del Gerente, Admin y Auditor (D-08).
    ['GET /v1/products/pending', ProductsController.prototype.findPending],
  ];

  it.each(cerradas)('%s sigue cerrada al Investigador', (_ruta, handler) => {
    const roles = rolesDe(handler);
    expect(roles).toBeDefined();
    expect(roles).not.toContain(ROL.INVESTIGADOR);
  });

  it('no se coló en PERFILES_INTERNOS: esa lista abre lecturas que D-28 no le da', () => {
    expect(PERFILES_INTERNOS as readonly string[]).not.toContain(ROL.INVESTIGADOR);
  });
});
