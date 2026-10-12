import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { PERFILES_INTERNOS, ROL } from '../common/roles';
import { AssociationController } from './association.controller';

/** Roles que exige cada ruta, leídos del `@Roles` del controlador. */
const rolesDe = (ruta: keyof AssociationController) =>
  new Reflector().get<string[]>(ROLES_KEY, AssociationController.prototype[ruta]);

describe('AssociationController: roles según la Matriz (§3, M10)', () => {
  it('solo el Analista comercial corre Apriori o FP-Growth (Total); el Administrador solo lee', () => {
    expect(rolesDe('runApriori')).toEqual([ROL.ANALISTA]);
    expect(rolesDe('runFpGrowth')).toEqual([ROL.ANALISTA]);
  });

  it('las corridas son lectura para los seis perfiles internos, no para el Proveedor', () => {
    for (const ruta of ['findAllRuns', 'findRun'] as const) {
      expect(rolesDe(ruta)).toEqual([...PERFILES_INTERNOS]);
      expect(rolesDe(ruta)).not.toContain(ROL.PROVEEDOR);
    }
  });
});
