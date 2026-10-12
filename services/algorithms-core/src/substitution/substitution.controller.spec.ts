import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { PERFILES_INTERNOS, ROL } from '../common/roles';
import { SubstitutionController } from './substitution.controller';

describe('SubstitutionController: roles', () => {
  it('los patrones son lectura para los seis perfiles internos, no para el Proveedor', () => {
    const roles = new Reflector().get<string[]>(ROLES_KEY, SubstitutionController.prototype.detectPatterns);
    expect(roles).toEqual([...PERFILES_INTERNOS]);
    expect(roles).not.toContain(ROL.PROVEEDOR);
  });
});
