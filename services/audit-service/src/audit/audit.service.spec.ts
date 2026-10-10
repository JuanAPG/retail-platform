import { AuditService } from './audit.service';

/**
 * Repositorio falso: guarda en memoria sin Postgres. `registrar()` escribe
 * SIEMPRE dentro de `manager.transaction()`, así que el falso expone un
 * `manager` que corre el callback y anota por dónde pasó cada escritura
 * (es lo que permite comprobar que el evento y sus cambios van juntos).
 */
function repoFalso() {
  const eventos: Record<string, unknown>[] = [];
  const cambios: Record<string, unknown>[] = [];
  let secuencia = 0;

  const manager = {
    create: jest.fn((_entidad: unknown, fila: object) => fila),
    save: jest.fn(async (fila: object | object[]) => {
      if (Array.isArray(fila)) {
        cambios.push(...(fila as Record<string, unknown>[]));
        return fila;
      }
      const guardado = { id: String(++secuencia), ...fila };
      eventos.push(guardado);
      return guardado;
    }),
  };

  const transaction = jest.fn(async (cb: (m: typeof manager) => Promise<unknown>) => cb(manager));

  return {
    eventos,
    cambios,
    manager,
    transaction,
    auditoriaRepo: { manager: { transaction } },
  };
}

function servicioCon(repo: ReturnType<typeof repoFalso>) {
  return new AuditService(repo.auditoriaRepo as never);
}

describe('AuditService.registrar', () => {
  it('guarda evento y cambios, devuelve el id', async () => {
    const repo = repoFalso();
    const id = await servicioCon(repo).registrar({
      tabla: 'usuarios',
      registroId: 'u1',
      servicio: 'pricing-service',
      accion: 'update',
      descripcion: 'Usuario actualizado.',
      cambios: [{ campo: 'activo', previo: 'true', posterior: 'false' }],
      usuarioId: 'u9',
      rolId: 1,
      ip: '172.18.0.5',
    });
    expect(id).toBe('1');
    expect(repo.cambios).toHaveLength(1);
    expect(repo.cambios[0]).toMatchObject({ campo: 'activo', valorPrevio: 'true' });
  });

  it('guarda el servicio emisor', async () => {
    const repo = repoFalso();
    await servicioCon(repo).registrar({
      tabla: 'precios',
      servicio: 'pricing-service',
      accion: 'login',
    });
    expect(repo.manager.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ servicio: 'pricing-service' }),
    );
  });

  it('sin cambios no toca auditoria_cambios', async () => {
    const repo = repoFalso();
    await servicioCon(repo).registrar({
      tabla: 'precios',
      servicio: 'pricing-service',
      accion: 'login',
    });
    expect(repo.cambios).toHaveLength(0);
  });

  // Regresión del DEFECTO-A/B: antes el evento se guardaba con un repo y
  // los cambios con otro, así que un fallo al insertar los cambios dejaba
  // el evento solo en la bitácora (y append-only = nadie lo puede corregir).
  it('evento y cambios se escriben en UNA sola transacción', async () => {
    const repo = repoFalso();
    await servicioCon(repo).registrar({
      tabla: 'precios',
      servicio: 'pricing-service',
      accion: 'update',
      cambios: [
        { campo: 'precio', previo: '10', posterior: '20' },
        { campo: 'vigencia', previo: null, posterior: '2026-10-13' },
      ],
    });
    expect(repo.transaction).toHaveBeenCalledTimes(1);
    expect(repo.eventos).toHaveLength(1);
    expect(repo.cambios).toHaveLength(2);
    // Las dos escrituras pasaron por el manager de la transacción.
    expect(repo.manager.save).toHaveBeenCalledTimes(2);
  });

  it('si falla el insert de los cambios, el error se propaga (la transacción revierte el evento)', async () => {
    const repo = repoFalso();
    repo.manager.save.mockImplementationOnce(async (fila: object | object[]) => ({
      id: '1',
      ...(fila as object),
    }));
    repo.manager.save.mockImplementationOnce(async () => {
      throw new Error('duplicate key value violates unique constraint');
    });
    await expect(
      servicioCon(repo).registrar({
        tabla: 'precios',
        servicio: 'pricing-service',
        accion: 'update',
        cambios: [{ campo: 'precio', previo: '10', posterior: '20' }],
      }),
    ).rejects.toThrow('duplicate key');
    // El fallo ocurrió DENTRO de la transacción: Postgres revierte el evento.
    expect(repo.transaction).toHaveBeenCalledTimes(1);
  });
});
