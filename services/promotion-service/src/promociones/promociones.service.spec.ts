import { BadRequestException, HttpException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { validateXML } from 'xmllint-wasm';
import { serializarXml } from '../common/interceptors/xml.interceptor';
import { ResultadoEntrega } from '../common/avisos/avisos.service';
import { CrearPromocionDto } from './dto';
import { ProductoCatalogo, UnidadCatalogo } from './fuentes';
import { PromocionesService } from './promociones.service';
import { FiltroPromociones, PromocionFila, PromocionNueva } from './repositorio';

/**
 * PromocionesService con dobles en memoria (sin Postgres ni HTTP): flujo de
 * §5 y §6, fechas límite de Monterrey, cálculos de §11 y §12 con el caso de
 * control, y cada respuesta en XML contra el XSD OFICIAL.
 */

const XSD = readFileSync(resolve(__dirname, '../../../../docs/contratos/promotion-service.xsd'), 'utf8');

async function erroresXsd(datos: unknown, raiz: string): Promise<string[]> {
  const xml = serializarXml(datos, { raiz, namespace: 'promotion/v1' });
  const r = await validateXML({ xml: [{ fileName: `${raiz}.xml`, contents: xml }], schema: [{ fileName: 'p.xsd', contents: XSD }] });
  return r.valid ? [] : r.errors.map((e) => e.rawMessage.trim());
}

const PRODUCTO = '1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const PRES_1KG = '8c3e1f20-4d5a-4b6c-9d7e-0f1a2b3c4d5e';
const PRES_INACTIVA = '9d4f2031-5e6b-4c7d-8e9f-1a2b3c4d5e6f';
const TIENDA = '27f05c81-c6bf-456a-a273-150e4edb9900';
const TIENDA_OTRA_ZONA = '38a16d92-d7c0-4671-b384-261f5fec0a11';
const ZONA = 'f2670df2-6c1a-4b8e-9d3f-7a5b2c1e0d44';
const GERENTE = { id: '2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d', rol: 'Gerente de categoría' };
const PRECIOS = { id: '3b4c5d6e-7f80-4b9c-8d1e-2f3a4b5c6d7e', rol: 'Responsable de precios' };
const TOKEN = 'Bearer token-de-prueba';

const UNIDADES: UnidadCatalogo[] = [
  { clave: 'g', tipo: 'masa', factorBase: '0.001000' },
  { clave: 'kg', tipo: 'masa', factorBase: '1.000000' },
  { clave: 'l', tipo: 'volumen', factorBase: '1.000000' },
  { clave: 'ml', tipo: 'volumen', factorBase: '0.001000' },
  { clave: 'pza', tipo: 'pieza', factorBase: '1.000000' },
];

function productoArroz(estatus = 'activo'): ProductoCatalogo {
  return {
    id: PRODUCTO,
    nombre: 'Arroz',
    estatus,
    presentaciones: [
      { id: PRES_1KG, productoId: PRODUCTO, nombre: '1 kg', contenido: '1.000', activo: true, unidadMedida: { clave: 'kg', tipo: 'masa', factorBase: '1.000000' } },
      { id: PRES_INACTIVA, productoId: PRODUCTO, nombre: '5 kg', contenido: '5.000', activo: false, unidadMedida: { clave: 'kg', tipo: 'masa', factorBase: '1.000000' } },
    ],
  };
}

/** Repositorio en memoria con la MISMA transición atómica (solo si sigue pendiente). */
class RepoFalso {
  filas = new Map<string, PromocionFila>();
  eventos: Array<{ id: string; promocionId: string; evento: string; auditoria?: ResultadoEntrega; aviso?: ResultadoEntrega }> = [];

  async crear(p: PromocionNueva) {
    const fila: PromocionFila = { ...p, id: randomUUID(), estatus: 'pendiente', propuestoEn: new Date('2026-10-29T17:20:00.000Z'), resueltoPor: null, resueltoEn: null, motivoRechazo: null };
    this.filas.set(fila.id, fila);
    const eventoId = randomUUID();
    this.eventos.push({ id: eventoId, promocionId: fila.id, evento: 'propuesta' });
    return { promocion: fila, eventoId };
  }
  async buscar(id: string) {
    return this.filas.get(id) ?? null;
  }
  async buscarVarias(ids: string[]) {
    return ids.map((id) => this.filas.get(id)).filter((x): x is PromocionFila => Boolean(x));
  }
  async listar(_f: FiltroPromociones, page: number, limit: number) {
    return { filas: [...this.filas.values()], total: this.filas.size, page, limit };
  }
  async resolver(id: string, a: 'aprobada' | 'rechazada', actor: string, hoy: string, motivo: string | null) {
    const f = this.filas.get(id);
    if (!f || f.estatus !== 'pendiente' || (a === 'aprobada' && f.vigenteHasta < hoy)) return null;
    Object.assign(f, { estatus: a, resueltoPor: actor, resueltoEn: new Date('2026-10-30T16:05:00.000Z'), motivoRechazo: motivo });
    const eventoId = randomUUID();
    this.eventos.push({ id: eventoId, promocionId: id, evento: a });
    return { promocion: f, eventoId };
  }
  async marcarEntrega(eventoId: string, auditoria: ResultadoEntrega, aviso: ResultadoEntrega) {
    Object.assign(this.eventos.find((e) => e.id === eventoId)!, { auditoria, aviso });
  }
}

function armar(precio: number | null = 30) {
  const repo = new RepoFalso();
  const fuentes = {
    producto: jest.fn(async (id: string) => (id === PRODUCTO ? productoArroz() : null)),
    tienda: jest.fn(async (id: string) =>
      id === TIENDA ? { id, activo: true, zonaId: ZONA } : id === TIENDA_OTRA_ZONA ? { id, activo: true, zonaId: randomUUID() } : null,
    ),
    zona: jest.fn(async (id: string) => (id === ZONA ? { id, activo: true } : null)),
    unidades: jest.fn(async () => UNIDADES),
    precioVigente: jest.fn(async () => (precio === null ? null : { price: precio, effectiveDate: '2026-10-01' })),
  };
  const avisos = {
    auditar: jest.fn(async (): Promise<ResultadoEntrega> => ({ estado: 'enviado', error: null })),
    notificar: jest.fn(async (): Promise<ResultadoEntrega> => ({ estado: 'fallido', error: 'HTTP 400' })),
  };
  const servicio = new PromocionesService(repo as never, fuentes as never, avisos as never);
  // "Hoy" = 29-oct-2026 a mediodía en Monterrey.
  servicio.ahora = () => new Date('2026-10-29T18:00:00.000Z');
  return { servicio, repo, fuentes, avisos };
}

function dto(parcial: Partial<CrearPromocionDto> = {}): CrearPromocionDto {
  return {
    name: 'Arroz 1 kg con 10 % en Zona Centro',
    type: 'descuento_porcentual',
    productId: PRODUCTO,
    presentationId: PRES_1KG,
    zoneId: ZONA,
    discountPct: 10,
    validFrom: '2026-11-01',
    validTo: '2026-11-15',
    ...parcial,
  } as CrearPromocionDto;
}

const PAQUETE = { type: 'paquete' as const, discountPct: undefined, packQuantity: 3, packPrice: 80, zoneId: undefined, storeId: TIENDA };
const EMPAQUE = { type: 'tamano_empaque' as const, discountPct: undefined, promoContent: 1200, promoUnit: 'g', promoPrice: 30, zoneId: undefined, storeId: TIENDA };

/** El cuerpo de la excepción (lo que el filtro convierte en el error estándar). */
async function fallo(p: Promise<unknown>): Promise<{ status: number; message: string; details?: string[] }> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(HttpException);
    const ex = e as HttpException;
    const r = ex.getResponse() as { message: string; details?: string[] };
    return { status: ex.getStatus(), message: typeof r === 'string' ? r : r.message, details: r.details };
  }
  throw new Error('Se esperaba un error.');
}

describe('proponer (§6)', () => {
  it('nace pendiente y programada; la respuesta valida contra el XSD (promocionResponse)', async () => {
    const { servicio, repo, avisos } = armar();
    const r = await servicio.proponer(dto(), GERENTE, TOKEN);
    expect(r).toMatchObject({ status: 'pendiente', validity: 'programada', proposedBy: GERENTE.id, storeId: null, zoneId: ZONA, currency: 'MXN', resolvedBy: null });
    expect(Object.keys(r)).toEqual([
      'id', 'name', 'type', 'productId', 'presentationId', 'storeId', 'zoneId', 'discountPct', 'packQuantity', 'packPrice',
      'promoContent', 'promoUnit', 'promoPrice', 'currency', 'validFrom', 'validTo', 'status', 'validity', 'proposedBy',
      'proposedAt', 'resolvedBy', 'resolvedAt', 'rejectionReason',
    ]);
    expect(await erroresXsd(r, 'promocionResponse')).toEqual([]);

    // §14: auditoría y aviso DESPUÉS de guardar; el estado de entrega queda en promocion_eventos.
    await servicio.esperarEntregas();
    expect(avisos.auditar).toHaveBeenCalledWith(expect.objectContaining({ tabla: 'promociones', accion: 'insert', registroId: r.id }), TOKEN);
    const aviso = (avisos.notificar.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(aviso).toMatchObject({ eventType: 'promocion.propuesta', relatedEntityId: r.id });
    expect(aviso).not.toHaveProperty('recipientUserId'); // destino fijo: rol Responsable de precios
    expect(repo.eventos[0]).toMatchObject({ evento: 'propuesta', auditoria: { estado: 'enviado' }, aviso: { estado: 'fallido' } });
  });

  it('guarda la medida de la presentación y el factor de promoUnit (tamaño de empaque)', async () => {
    const { servicio, repo } = armar();
    const r = await servicio.proponer(dto(EMPAQUE), GERENTE, TOKEN);
    expect(repo.filas.get(r.id)).toMatchObject({ presentacionUnidad: 'kg', presentacionFactor: 1, unidadTipo: 'masa', empaqueUnidad: 'g', empaqueFactor: 0.001 });
  });

  it('tamaño de empaque 1,200 ml sobre arroz en kg → 400 "Unidades incompatibles." con el detalle del contrato', async () => {
    const { servicio, repo, avisos } = armar();
    const e = await fallo(servicio.proponer(dto({ ...EMPAQUE, promoUnit: 'ml' }), GERENTE, TOKEN));
    expect(e).toEqual({ status: 400, message: 'Unidades incompatibles.', details: ['promoUnit: ml (volumen) no se compara con la presentación en kg (masa)'] });
    expect(repo.filas.size).toBe(0);
    expect(avisos.auditar).not.toHaveBeenCalled(); // si falla, no se audita ni se avisa
  });

  it.each([
    ['ninguno de storeId/zoneId', { zoneId: undefined }, /exactamente uno de storeId o zoneId/],
    ['los dos', { storeId: TIENDA }, /exactamente uno de storeId o zoneId/],
    ['discountPct y packPrice a la vez', { packPrice: 80 }, /packPrice no corresponde/],
    ['validTo < validFrom', { validFrom: '2026-11-10', validTo: '2026-11-09' }, /validTo no puede ser anterior/],
    ['fecha inexistente', { validTo: '2026-02-30' }, /validTo no es una fecha válida/],
  ])('400: %s', async (_caso, parcial, esperado) => {
    const { servicio } = armar();
    const e = await fallo(servicio.proponer(dto(parcial), GERENTE, TOKEN));
    expect(e.status).toBe(400);
    expect(e.details?.join(' ')).toMatch(esperado);
  });

  it.each([
    ['producto inexistente', { productId: randomUUID() }, /El producto no existe/],
    ['presentación de otro producto', { presentationId: randomUUID() }, /no existe o no es de ese producto/],
    ['zona inexistente', { zoneId: randomUUID() }, /La zona no existe/],
    ['tienda inexistente', { zoneId: undefined, storeId: randomUUID() }, /La tienda no existe/],
    ['promoUnit desconocida', { ...EMPAQUE, promoUnit: 'oz' }, /promoUnit oz no existe/],
  ])('400 (catálogo): %s', async (_caso, parcial, esperado) => {
    const { servicio } = armar();
    const e = await fallo(servicio.proponer(dto(parcial), GERENTE, TOKEN));
    expect(e.status).toBe(400);
    expect([e.message, ...(e.details ?? [])].join(' ')).toMatch(esperado);
  });

  it('409: presentación dada de baja o producto no activo (D-07, D-08)', async () => {
    const { servicio, fuentes } = armar();
    expect((await fallo(servicio.proponer(dto({ presentationId: PRES_INACTIVA }), GERENTE, TOKEN))).status).toBe(409);
    fuentes.producto.mockResolvedValueOnce(productoArroz('pendiente_aprobacion'));
    expect((await fallo(servicio.proponer(dto(), GERENTE, TOKEN))).status).toBe(409);
  });
});

describe('fechas límite en America/Monterrey (UTC−06:00)', () => {
  it('validFrom = hoy se acepta; ayer no (el día cambia a las 06:00 UTC)', async () => {
    const { servicio } = armar();
    // 2026-11-01T05:59:59Z = 31-oct 23:59:59 en Monterrey: hoy es 31-oct.
    servicio.ahora = () => new Date('2026-11-01T05:59:59.000Z');
    await expect(servicio.proponer(dto({ validFrom: '2026-10-31' }), GERENTE, TOKEN)).resolves.toMatchObject({ validity: 'vigente' });
    // Un segundo después ya es 1-nov: el 31-oct es pasado.
    servicio.ahora = () => new Date('2026-11-01T06:00:00.000Z');
    const e = await fallo(servicio.proponer(dto({ validFrom: '2026-10-31' }), GERENTE, TOKEN));
    expect(e.details).toEqual(['validFrom debe ser hoy (2026-11-01) o después: no hay promociones retroactivas']);
  });

  it('validity: programada → vigente (validFrom y validTo inclusivos) → vencida', async () => {
    const { servicio } = armar();
    const { id } = await servicio.proponer(dto(), GERENTE, TOKEN);
    const en = async (instante: string) => {
      servicio.ahora = () => new Date(instante);
      return (await servicio.obtener(id)).validity;
    };
    expect(await en('2026-11-01T05:59:59Z')).toBe('programada'); // 31-oct local
    expect(await en('2026-11-01T06:00:00Z')).toBe('vigente'); // 1-nov local
    expect(await en('2026-11-16T05:59:59Z')).toBe('vigente'); // 15-nov 23:59:59 local
    expect(await en('2026-11-16T06:00:00Z')).toBe('vencida'); // 16-nov local
  });

  it('aprobar el último día se puede; al día siguiente → 409 con la fecha', async () => {
    const { servicio } = armar();
    const a = await servicio.proponer(dto(), GERENTE, TOKEN);
    const b = await servicio.proponer(dto(), GERENTE, TOKEN);
    servicio.ahora = () => new Date('2026-11-16T05:59:59Z'); // 15-nov local
    await expect(servicio.aprobar(a.id, PRECIOS, TOKEN)).resolves.toMatchObject({ status: 'aprobada', validity: 'vigente' });
    servicio.ahora = () => new Date('2026-11-16T06:00:00Z'); // 16-nov local
    expect(await fallo(servicio.aprobar(b.id, PRECIOS, TOKEN))).toEqual({
      status: 409,
      message: 'La vigencia de la promoción terminó el 2026-11-15; ya no se puede aprobar.',
      details: undefined,
    });
    // Rechazar una pendiente vencida sí se permite (limpia la bandeja).
    await expect(servicio.rechazar(b.id, 'Se venció sin revisarse a tiempo.', PRECIOS, TOKEN)).resolves.toMatchObject({ status: 'rechazada' });
  });
});

describe('resolver (§9, §10)', () => {
  it('aprobar: guarda quién y cuándo, audita "aprobar" y avisa a quien propuso; XML válido', async () => {
    const { servicio, avisos } = armar();
    const { id } = await servicio.proponer(dto(), GERENTE, TOKEN);
    const r = await servicio.aprobar(id, PRECIOS, TOKEN);
    expect(r).toMatchObject({ status: 'aprobada', resolvedBy: PRECIOS.id, validity: 'programada', rejectionReason: null });
    expect(await erroresXsd(r, 'promocionResponse')).toEqual([]);
    await servicio.esperarEntregas();
    expect(avisos.auditar).toHaveBeenLastCalledWith(
      expect.objectContaining({ accion: 'aprobar', cambios: [{ campo: 'estatus', previo: 'pendiente', posterior: 'aprobada' }] }),
      TOKEN,
    );
    expect(avisos.notificar).toHaveBeenLastCalledWith(
      expect.objectContaining({ eventType: 'promocion.resuelta', recipientUserId: GERENTE.id }),
      TOKEN,
    );
  });

  it('doble resolución → 409 y no se audita de nuevo', async () => {
    const { servicio, avisos } = armar();
    const { id } = await servicio.proponer(dto(), GERENTE, TOKEN);
    await servicio.aprobar(id, PRECIOS, TOKEN);
    await servicio.esperarEntregas();
    const llamadas = avisos.auditar.mock.calls.length;
    expect(await fallo(servicio.aprobar(id, PRECIOS, TOKEN))).toMatchObject({ status: 409, message: 'La promoción ya está aprobada; no se resuelve dos veces.' });
    expect((await fallo(servicio.rechazar(id, 'Ya no aplica para la temporada.', PRECIOS, TOKEN))).status).toBe(409);
    expect(avisos.auditar.mock.calls.length).toBe(llamadas);
  });

  it('rechazar: rechazada, con motivo y SIN validity; XML válido', async () => {
    const { servicio, avisos } = armar();
    const { id } = await servicio.proponer(dto(), GERENTE, TOKEN);
    const r = await servicio.rechazar(id, 'El descuento se encima con la campaña de regreso a clases.', PRECIOS, TOKEN);
    expect(r).toMatchObject({ status: 'rechazada', rejectionReason: 'El descuento se encima con la campaña de regreso a clases.' });
    expect(r).not.toHaveProperty('validity');
    expect(await erroresXsd(r, 'promocionResponse')).toEqual([]);
    await servicio.esperarEntregas();
    expect(avisos.auditar).toHaveBeenLastCalledWith(
      expect.objectContaining({ accion: 'rechazar', descripcion: expect.stringContaining('regreso a clases') }),
      TOKEN,
    );
  });

  it('inexistente → 404', async () => {
    const { servicio } = armar();
    await expect(servicio.aprobar(randomUUID(), PRECIOS, TOKEN)).rejects.toBeInstanceOf(NotFoundException);
    await expect(servicio.obtener(randomUUID())).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('precio unitario (§11) con el caso de control', () => {
  it('paquete 3 por $80 en su tienda: 26.67 MXN/kg, ahorro 11.11 %; XML válido', async () => {
    const { servicio } = armar();
    const { id } = await servicio.proponer(dto(PAQUETE), GERENTE, TOKEN);
    const r = await servicio.precioUnitario(id, undefined, TOKEN);
    expect(r).toEqual({
      promotionId: id,
      type: 'paquete',
      status: 'pendiente',
      productId: PRODUCTO,
      presentationId: PRES_1KG,
      storeId: TIENDA,
      baseUnit: 'kg',
      currency: 'MXN',
      disponible: true,
      motivo: null,
      regular: { disponible: true, price: 30, effectiveDate: '2026-10-01', contentBase: 1, unitPrice: 30, motivo: null },
      promotional: { purchasePrice: 80, items: 3, contentBase: 3, unitPrice: 26.67 },
      savingsPct: 11.11,
    });
    expect(await erroresXsd(r, 'precioUnitarioResponse')).toEqual([]);
  });

  it('descuento SIN precio regular: disponible false, sin promotional ni savingsPct (nunca 0); XML válido', async () => {
    const { servicio } = armar(null);
    const { id } = await servicio.proponer(dto(), GERENTE, TOKEN);
    const r = await servicio.precioUnitario(id, TIENDA, TOKEN);
    expect(r).toMatchObject({ disponible: false, motivo: expect.stringContaining('sin precio regular'), regular: { disponible: false, motivo: 'Sin precio vigente en pricing-service.' } });
    expect(r).not.toHaveProperty('promotional');
    expect(r).not.toHaveProperty('savingsPct');
    expect(await erroresXsd(r, 'precioUnitarioResponse')).toEqual([]);
  });

  it('paquete sin precio regular: el promocional sí se calcula; sin savingsPct', async () => {
    const { servicio } = armar(null);
    const { id } = await servicio.proponer(dto(PAQUETE), GERENTE, TOKEN);
    const r = await servicio.precioUnitario(id, undefined, TOKEN);
    expect(r).toMatchObject({ disponible: true, regular: { disponible: false }, promotional: { unitPrice: 26.67 } });
    expect(r).not.toHaveProperty('savingsPct');
    expect(await erroresXsd(r, 'precioUnitarioResponse')).toEqual([]);
  });

  it('por zona: storeId obligatorio y debe ser una tienda activa de la zona (400)', async () => {
    const { servicio } = armar();
    const { id } = await servicio.proponer(dto(), GERENTE, TOKEN);
    expect(await fallo(servicio.precioUnitario(id, undefined, TOKEN))).toMatchObject({ status: 400, message: 'storeId es obligatorio para una promoción por zona.' });
    expect((await fallo(servicio.precioUnitario(id, TIENDA_OTRA_ZONA, TOKEN))).status).toBe(400);
    await expect(servicio.precioUnitario(id, TIENDA, TOKEN)).resolves.toMatchObject({ disponible: true, savingsPct: 10 });
  });

  it('por tienda: otra tienda → 400 fuera del ámbito', async () => {
    const { servicio } = armar();
    const { id } = await servicio.proponer(dto(PAQUETE), GERENTE, TOKEN);
    expect((await fallo(servicio.precioUnitario(id, TIENDA_OTRA_ZONA, TOKEN))).message).toMatch(/fuera del ámbito/);
  });
});

describe('comparar (§12) con el caso de control', () => {
  async function tres() {
    const h = armar();
    const descuento = await h.servicio.proponer(dto(), GERENTE, TOKEN);
    const paquete = await h.servicio.proponer(dto(PAQUETE), GERENTE, TOKEN);
    const empaque = await h.servicio.proponer(dto(EMPAQUE), GERENTE, TOKEN);
    return { ...h, ids: [descuento.id, paquete.id, empaque.id], descuento, paquete, empaque };
  }

  it('orden tamaño (25.00) → paquete (26.67) → descuento (27.00), ahorros 16.67, 11.11, 10.00; XML válido', async () => {
    const { servicio, ids, descuento, paquete, empaque } = await tres();
    const r = await servicio.comparar({ ids, storeId: TIENDA }, TOKEN);
    expect(r.data.map((d) => [d.promotionId, d.unitPrice, d.regularUnitPrice, d.savingsPct])).toEqual([
      [empaque.id, 25, 30, 16.67],
      [paquete.id, 26.67, 30, 11.11],
      [descuento.id, 27, 30, 10],
    ]);
    expect(r).toMatchObject({ productId: PRODUCTO, storeId: TIENDA, baseUnit: 'kg', currency: 'MXN' });
    expect(await erroresXsd(r, 'comparacionPromocionesResponse')).toEqual([]);
  });

  it('una no disponible (descuento sin precio regular) va al final con motivo; XML válido', async () => {
    const { servicio, ids, fuentes, descuento } = await tres();
    fuentes.precioVigente.mockResolvedValue(null);
    const r = await servicio.comparar({ ids, storeId: TIENDA }, TOKEN);
    expect(r.data[2]).toMatchObject({ promotionId: descuento.id, disponible: false, motivo: expect.any(String) });
    expect(r.data[2]).not.toHaveProperty('unitPrice');
    expect(await erroresXsd(r, 'comparacionPromocionesResponse')).toEqual([]);
  });

  it('productos distintos → 400; alguna inexistente → 404; tienda fuera del ámbito → 400', async () => {
    const { servicio, ids, repo } = await tres();
    const otro = repo.filas.get(ids[1])!;
    repo.filas.set('ffffffff-0000-4000-8000-000000000000', { ...otro, id: 'ffffffff-0000-4000-8000-000000000000', productoId: randomUUID() });
    expect(await fallo(servicio.comparar({ ids: [ids[0], 'ffffffff-0000-4000-8000-000000000000'], storeId: TIENDA }, TOKEN))).toMatchObject({
      status: 400,
      message: expect.stringContaining('productos distintos'),
    });
    await expect(servicio.comparar({ ids: [ids[0], randomUUID()], storeId: TIENDA }, TOKEN)).rejects.toBeInstanceOf(NotFoundException);
    expect((await fallo(servicio.comparar({ ids, storeId: TIENDA_OTRA_ZONA }, TOKEN))).status).toBe(400);
  });

  it('presentaciones con tipos de unidad distintos → 400 "Unidades incompatibles."', async () => {
    const { servicio, ids, repo } = await tres();
    const litro = { ...repo.filas.get(ids[1])!, id: 'eeeeeeee-0000-4000-8000-000000000000', unidadTipo: 'volumen' as const, presentacionUnidad: 'l' };
    repo.filas.set(litro.id, litro);
    expect(await fallo(servicio.comparar({ ids: [ids[1], litro.id], storeId: TIENDA }, TOKEN))).toEqual({
      status: 400,
      message: 'Unidades incompatibles.',
      details: ['Las presentaciones mezclan kg (masa) y l (volumen); no se comparan.'],
    });
  });
});

describe('listar (§7)', () => {
  it('la lista valida contra el XSD (promocionListResponse)', async () => {
    const { servicio } = armar();
    await servicio.proponer(dto(), GERENTE, TOKEN);
    await servicio.proponer(dto(PAQUETE), GERENTE, TOKEN);
    const r = await servicio.listar({});
    expect(r.total).toBe(2);
    expect(await erroresXsd(r, 'promocionListResponse')).toEqual([]);
  });

  it('activeOn inválido → 400', async () => {
    const { servicio } = armar();
    await expect(servicio.listar({ activeOn: '2026-02-30' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

