import { PriceAlertsService } from './price-alerts.service';

const usuario = { id: 'u-prec', email: 'p@retail.mx', rol: 'Responsable de precios', rolId: 4 };

/** Consultas en orden: configuración, precio base (en la ventana), [más antiguo], [contexto]. */
function armar(opciones: { umbral?: number; ventana?: number; base?: number | null; masAntiguo?: number | null; sinConfig?: boolean }) {
  const { umbral = 5, ventana = 30, base = 100, masAntiguo = null, sinConfig = false } = opciones;
  const consultas: Array<{ sql: string; params: unknown[] }> = [];
  const dataSource = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      consultas.push({ sql, params });
      if (sql.includes('FROM config_alertas_precio')) return sinConfig ? [] : [{ umbral, ventana_dias: ventana, actualizado_por: null, updated_at: null }];
      if (sql.includes('fecha_vigencia_desde <= ($3::date - $4::int)')) return base === null ? [] : [{ precio: base }];
      if (sql.includes('fecha_vigencia_desde < $3::date')) return masAntiguo === null ? [] : [{ precio: masAntiguo }];
      if (sql.includes('FROM producto_presentaciones pres')) return [{ producto: 'Leche entera', presentacion: '1 L', tienda: 'Super Valle' }];
      return [];
    }),
  };
  const audit = { reportar: jest.fn().mockResolvedValue(undefined) };
  const notificaciones = { emitir: jest.fn().mockResolvedValue(undefined) };
  const servicio = new PriceAlertsService(dataSource as never, audit as never, notificaciones as never);
  return { servicio, dataSource, audit, notificaciones, consultas };
}

const cambio = (nuevoPrecio: number) => ({ presentationId: 'pres-1', storeId: 't-1', nuevoPrecio, effectiveDate: '2026-10-08' });

describe('PriceAlertsService.evaluar (PRI-07, D-09)', () => {
  it('justo debajo del umbral NO avisa: 4.99 % con umbral de 5 %', async () => {
    const { servicio, notificaciones } = armar({ base: 100 });
    const r = await servicio.evaluar(cambio(104.99), 'Bearer t');
    expect(r).toEqual({ alerta: false, basePrecio: 100, variacionPct: 4.99 });
    expect(notificaciones.emitir).not.toHaveBeenCalled();
  });

  it('exactamente en el umbral SÍ avisa: 5 %', async () => {
    const { servicio, notificaciones } = armar({ base: 100 });
    const r = await servicio.evaluar(cambio(105), 'Bearer t');
    expect(r).toMatchObject({ alerta: true, variacionPct: 5 });
    expect(notificaciones.emitir).toHaveBeenCalledTimes(1);
  });

  it('justo arriba del umbral SÍ avisa: 5.01 %', async () => {
    const { servicio, notificaciones } = armar({ base: 100 });
    expect(await servicio.evaluar(cambio(105.01), 't')).toMatchObject({ alerta: true, variacionPct: 5.01 });
    expect(notificaciones.emitir).toHaveBeenCalledTimes(1);
  });

  it('una baja también cuenta (variación absoluta) y el mensaje dice que bajó', async () => {
    const { servicio, notificaciones } = armar({ base: 100 });
    await servicio.evaluar(cambio(90), 'Bearer t');
    const [evento] = notificaciones.emitir.mock.calls[0];
    expect(evento).toMatchObject({ eventType: 'precio.umbral', relatedEntityType: 'presentacion', relatedEntityId: 'pres-1' });
    expect(evento.message).toContain('bajó de 100.00 a 90.00');
    expect(evento.title).toContain('10 %');
  });

  it('avisa con el token de quien registró el precio y no manda destinatario (lo fija el receptor: Responsable de precios)', async () => {
    const { servicio, notificaciones } = armar({ base: 100 });
    await servicio.evaluar(cambio(120), 'Bearer abc');
    const [evento, token] = notificaciones.emitir.mock.calls[0];
    expect(token).toBe('Bearer abc');
    expect(evento).not.toHaveProperty('recipientUserId');
    expect(evento.priority).toBe('critical'); // 20 % >= 2 x umbral
  });

  it('compara contra el precio al INICIO de la ventana (fecha efectiva - N días), no contra el inmediato anterior', async () => {
    const { servicio, consultas } = armar({ base: 100, ventana: 30 });
    await servicio.evaluar(cambio(111), 't');
    const q = consultas.find((c) => c.sql.includes('fecha_vigencia_desde <= ($3::date - $4::int)'))!;
    expect(q.params).toEqual(['pres-1', 't-1', '2026-10-08', 30]);
  });

  it('un 1 % diario durante una semana acumulado sobre la base SÍ cruza un umbral del 5 % (el caso por el que existe la ventana)', async () => {
    // La base no es "ayer" (que valdría 106): es el precio al inicio de la ventana (100).
    const { servicio, notificaciones } = armar({ base: 100, umbral: 5 });
    expect((await servicio.evaluar(cambio(106.15), 't')).alerta).toBe(true); // 1.01^6
    expect(notificaciones.emitir).toHaveBeenCalled();
  });

  it('si el historial es más corto que la ventana, toma el precio más antiguo disponible', async () => {
    const { servicio } = armar({ base: null, masAntiguo: 200 });
    expect(await servicio.evaluar(cambio(220), 't')).toMatchObject({ alerta: true, basePrecio: 200, variacionPct: 10 });
  });

  it('sin historial previo no hay con qué comparar: no avisa', async () => {
    const { servicio, notificaciones } = armar({ base: null, masAntiguo: null });
    expect(await servicio.evaluar(cambio(500), 't')).toEqual({ alerta: false, basePrecio: null, variacionPct: null });
    expect(notificaciones.emitir).not.toHaveBeenCalled();
  });

  it('sin configuración usa los defaults de D-09: 5 % en 30 días', async () => {
    const { servicio } = armar({ sinConfig: true, base: 100 });
    expect(await servicio.getSettings()).toMatchObject({ umbralPct: 5, ventanaDias: 30, updatedBy: null });
  });

  it('el umbral es el que configuró el Responsable: con 10 %, un 7 % no avisa', async () => {
    const { servicio, notificaciones } = armar({ umbral: 10, base: 100 });
    expect((await servicio.evaluar(cambio(107), 't')).alerta).toBe(false);
    expect(notificaciones.emitir).not.toHaveBeenCalled();
  });

  it('una alerta que falla (BD o notificaciones caídas) nunca rompe el alta', async () => {
    const { servicio, dataSource } = armar({ base: 100 });
    dataSource.query.mockRejectedValue(new Error('BD caída'));
    await expect(servicio.evaluar(cambio(150), 't')).resolves.toEqual({ alerta: false, basePrecio: null, variacionPct: null });
  });
});

describe('PriceAlertsService.updateSettings', () => {
  it('guarda umbral y ventana con quién los cambió y audita el antes y el después', async () => {
    const { servicio, dataSource, audit } = armar({ umbral: 5, ventana: 30 });

    await servicio.updateSettings({ umbralPct: 10, ventanaDias: 7 }, usuario, '10.0.0.1', 'Bearer t');

    const upsert = dataSource.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO config_alertas_precio'))!;
    expect(upsert[1]).toEqual([10, 7, 'u-prec']);
    const [evento, token] = audit.reportar.mock.calls[0];
    expect(evento).toMatchObject({ tabla: 'config_alertas_precio', accion: 'update', ip: '10.0.0.1' });
    expect(evento.cambios).toEqual([
      { campo: 'umbral_pct', previo: '5', posterior: '10' },
      { campo: 'ventana_dias', previo: '30', posterior: '7' },
    ]);
    expect(token).toBe('Bearer t');
  });
});
