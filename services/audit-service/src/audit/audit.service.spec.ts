import { AuditService } from './audit.service';

/** Repositorios falsos: guardan en memoria sin Postgres. */
function reposFalsos() {
  const eventos: Record<string, unknown>[] = [];
  const cambios: Record<string, unknown>[] = [];
  let secuencia = 0;
  return {
    eventos,
    cambios,
    auditoriaRepo: {
      create: jest.fn((fila: object) => fila),
      save: jest.fn(async (fila: object) => ({ id: String(++secuencia), ...fila })),
    },
    cambiosRepo: {
      create: jest.fn((fila: object) => fila),
      save: jest.fn(async (filas: Record<string, unknown>[]) => {
        cambios.push(...filas);
        return filas;
      }),
    },
  };
}

describe('AuditService.registrar', () => {
  it('guarda evento y cambios, devuelve el id', async () => {
    const { auditoriaRepo, cambiosRepo, cambios } = reposFalsos();
    const servicio = new AuditService(auditoriaRepo as never, cambiosRepo as never);
    const id = await servicio.registrar({
      tabla: 'usuarios',
      registroId: 'u1',
      accion: 'update',
      descripcion: 'Usuario actualizado.',
      cambios: [{ campo: 'activo', previo: 'true', posterior: 'false' }],
      usuarioId: 'u9',
      rolId: 1,
      ip: '172.18.0.5',
    });
    expect(id).toBe('1');
    expect(cambios).toHaveLength(1);
    expect(cambios[0]).toMatchObject({ campo: 'activo', valorPrevio: 'true' });
  });

  it('sin cambios no toca auditoria_cambios', async () => {
    const { auditoriaRepo, cambiosRepo, cambios } = reposFalsos();
    const servicio = new AuditService(auditoriaRepo as never, cambiosRepo as never);
    await servicio.registrar({ tabla: 'precios', accion: 'login' });
    expect(cambios).toHaveLength(0);
  });
});
