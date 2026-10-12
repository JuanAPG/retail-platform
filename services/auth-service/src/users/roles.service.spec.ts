import { RolesService } from './roles.service';

describe('RolesService.reemplazarMatriz — auditoría', () => {
  function armar() {
    const rolesRepo = { findOne: jest.fn().mockResolvedValue({ id: 3, nombre: 'Gerente de categoría' }) };
    const modulosRepo = {
      find: jest.fn().mockResolvedValue([{ id: 1, clave: 'M01', nombre: 'Autenticación' }]),
    };
    const permisosRepo = {
      delete: jest.fn().mockResolvedValue(undefined),
      save: jest.fn().mockResolvedValue(undefined),
      create: jest.fn((datos: object) => datos),
      find: jest.fn().mockResolvedValue([]),
    };
    const auditoria = { reportar: jest.fn().mockResolvedValue(undefined) };
    const servicio = new RolesService(
      rolesRepo as never,
      modulosRepo as never,
      permisosRepo as never,
      auditoria as never,
    );
    return { servicio, auditoria };
  }

  it('reporta el reemplazo reenviando el token, sin usuarioId/rolId en el cuerpo', async () => {
    const { servicio, auditoria } = armar();

    await servicio.reemplazarMatriz(3, [{ moduloId: 1, nivel: 'total' }], '1.2.3.4', 'Bearer t-admin');

    expect(auditoria.reportar).toHaveBeenCalledWith(
      expect.objectContaining({ tabla: 'rol_modulo_permiso', accion: 'update', ip: '1.2.3.4' }),
      'Bearer t-admin',
    );
    const cuerpo = auditoria.reportar.mock.calls[0][0];
    expect(cuerpo).not.toHaveProperty('usuarioId');
    expect(cuerpo).not.toHaveProperty('rolId');
  });
});
