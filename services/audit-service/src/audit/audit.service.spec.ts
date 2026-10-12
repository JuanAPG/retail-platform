import { AuditService, ZONA_HORARIA } from './audit.service';

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

/**
 * Query builder falso: no ejecuta SQL, solo anota las condiciones y los
 * parámetros con los que se armó la consulta. Alcanza para fijar que los
 * dos extremos del rango de fechas se resuelven en el huso de quien lee
 * la bitácora y no en el de la base.
 */
function qbFalso() {
  const condiciones: { sql: string; params: Record<string, unknown> }[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const qb: any = {
    leftJoinAndSelect: jest.fn(() => qb),
    orderBy: jest.fn(() => qb),
    addOrderBy: jest.fn(() => qb),
    skip: jest.fn(() => qb),
    take: jest.fn(() => qb),
    andWhere: jest.fn((sql: string, params: Record<string, unknown>) => {
      condiciones.push({ sql, params });
      return qb;
    }),
    getManyAndCount: jest.fn(async () => [[], 0]),
  };
  return { qb, condiciones };
}

describe('AuditService.find — el día es el día local, no el día UTC', () => {
  function servicioConQb() {
    const { qb, condiciones } = qbFalso();
    const repo = { createQueryBuilder: jest.fn(() => qb), manager: { transaction: jest.fn() } };
    return { servicio: new AuditService(repo as never), condiciones, qb };
  }

  it('el huso fijado es America/Monterrey', () => {
    expect(ZONA_HORARIA).toBe('America/Monterrey');
  });

  it('los dos extremos se construyen con AT TIME ZONE y el mismo huso', async () => {
    const { servicio, condiciones } = servicioConQb();
    await servicio.find({ dateFrom: '2026-10-01', dateTo: '2026-10-10' });

    const desde = condiciones.find((c) => 'dateFrom' in c.params);
    const hasta = condiciones.find((c) => 'dateTo' in c.params);
    expect(desde!.sql).toContain('AT TIME ZONE :zona');
    expect(hasta!.sql).toContain('AT TIME ZONE :zona');
    expect(desde!.params.zona).toBe(ZONA_HORARIA);
    expect(hasta!.params.zona).toBe(ZONA_HORARIA);
    // `dateTo` es inclusivo: hasta el final del día, o sea < el día siguiente.
    expect(hasta!.sql).toContain('+ 1');
    expect(hasta!.sql).toContain('<');
    expect(desde!.sql).toContain('>=');
  });

  it('sin filtros de fecha no se agrega ninguna condición de fecha', async () => {
    const { servicio, condiciones } = servicioConQb();
    await servicio.find({});
    expect(condiciones.filter((c) => c.sql.includes('fecha'))).toHaveLength(0);
  });

  it('pagina por entidad (skip/take), no por filas del JOIN', async () => {
    const { servicio, qb } = servicioConQb();
    await servicio.find({ page: 3, limit: 20 });
    expect(qb.skip).toHaveBeenCalledWith(40);
    expect(qb.take).toHaveBeenCalledWith(20);
  });

  it('limit se tope a 100', async () => {
    const { servicio, qb } = servicioConQb();
    const pagina = await servicio.find({ limit: 500 });
    expect(qb.take).toHaveBeenCalledWith(100);
    expect(pagina.limit).toBe(100);
  });
});
