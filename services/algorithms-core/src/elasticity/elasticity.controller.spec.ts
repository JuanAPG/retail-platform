import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { PERFILES_INTERNOS, ROL } from '../common/roles';
import { ElasticityController } from './elasticity.controller';

/** Roles que exige cada ruta, leídos del `@Roles` del controlador. */
const rolesDe = (ruta: keyof ElasticityController) =>
  new Reflector().get<string[]>(ROLES_KEY, ElasticityController.prototype[ruta]);

describe('ElasticityController: roles según la Matriz (§3, M11)', () => {
  it('solo el Responsable de precios calcula (Total)', () => {
    expect(rolesDe('calculate')).toEqual([ROL.RESPONSABLE_PRECIOS]);
  });

  it('el gráfico y la elasticidad vigente son lectura para los seis perfiles internos, no para el Proveedor', () => {
    for (const ruta of ['getComparativeChart', 'current'] as const) {
      expect(rolesDe(ruta)).toEqual([...PERFILES_INTERNOS]);
      expect(rolesDe(ruta)).not.toContain(ROL.PROVEEDOR);
    }
  });
});
