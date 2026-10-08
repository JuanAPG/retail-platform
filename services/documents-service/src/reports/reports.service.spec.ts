import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Types } from 'mongoose';
import { SesionUsuario } from '../common/auth/session.guard';
import { ReportsService } from './reports.service';

const gerente: SesionUsuario = { id: 'u-ger', email: 'g@retail.mx', rol: 'Gerente de categoría', rolId: 3 };
const provA: SesionUsuario = { id: 'u-pa', email: 'a@prov.mx', rol: 'Proveedor', rolId: 7 };
const provB: SesionUsuario = { id: 'u-pb', email: 'b@prov.mx', rol: 'Proveedor', rolId: 7 };

const idValido = new Types.ObjectId().toHexString();

function doc(extra: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(idValido),
    tipo: 'ejecutivo',
    parametros: { dateFrom: '2026-08-01', dateTo: '2026-08-31', zoneId: null, segmentId: null },
    formato: 'json',
    usuarioId: 'u-ger',
    estado: 'generado',
    creadoEn: new Date('2026-10-08T18:00:00Z'),
    secciones: [],
    save: jest.fn().mockResolvedValue(undefined),
    ...extra,
  };
}

function crear(readyState = 1) {
  const consulta = { sort: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), lean: jest.fn() };
  consulta.lean.mockResolvedValue([doc()]);
  const modelo = {
    create: jest.fn(async (x: Record<string, unknown>) => ({ ...doc(), ...x })),
    find: jest.fn(() => consulta),
    countDocuments: jest.fn().mockResolvedValue(1),
    findById: jest.fn(),
    aggregate: jest.fn().mockResolvedValue([]),
  };
  const indicadores = { reunir: jest.fn().mockResolvedValue([{ clave: 'x', nombre: 'X', servicio: 's', disponible: false, valor: null, motivo: 'caído' }]) };
  const pdf = { generar: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.3')) };
  const audit = { reportar: jest.fn().mockResolvedValue(undefined) };
  const servicio = new ReportsService(modelo as never, { readyState } as never, indicadores as never, pdf as never, audit as never);
  return { modelo, consulta, indicadores, pdf, audit, servicio };
}

describe('ReportsService', () => {
  it('con Mongo caído responde 503 al instante, sin consultar ni armar el reporte', async () => {
    const { servicio, indicadores, modelo } = crear(0);

    await expect(servicio.generarEjecutivo({ dateFrom: '2026-08-01', dateTo: '2026-08-31' }, gerente, 't')).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(servicio.listar({}, gerente)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(servicio.obtener(idValido, gerente)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(indicadores.reunir).not.toHaveBeenCalled();
    expect(modelo.find).not.toHaveBeenCalled();
  });

  it('generar guarda el reporte con el usuario del token y audita (no bloquea si la auditoría falla)', async () => {
    const { servicio, modelo, audit } = crear();

    const r = await servicio.generarEjecutivo({ dateFrom: '2026-08-01', dateTo: '2026-08-31', zoneId: 'z1' }, gerente, 'Bearer t', '10.0.0.1');

    expect(modelo.create).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: 'ejecutivo', usuarioId: 'u-ger', parametros: { dateFrom: '2026-08-01', dateTo: '2026-08-31', zoneId: 'z1', segmentId: null } }),
    );
    expect(r.secciones[0]).toMatchObject({ disponible: false, motivo: 'caído' });
    expect(audit.reportar).toHaveBeenCalledWith(expect.objectContaining({ tabla: 'reportes', accion: 'insert', ip: '10.0.0.1' }), 'Bearer t');
  });

  it('DOC-04: un Proveedor lista solo lo suyo aunque pida ?usuarioId= de otro', async () => {
    const { servicio, modelo } = crear();

    await servicio.listar({ usuarioId: 'u-pb' }, provA);

    expect(modelo.find).toHaveBeenCalledWith({ usuarioId: 'u-pa' });
  });

  it('un interno puede filtrar por usuario, tipo y fechas, y pagina con el tope de 100', async () => {
    const { servicio, modelo, consulta } = crear();

    const p = await servicio.listar({ usuarioId: 'u1', tipo: 'ejecutivo', dateFrom: '2026-10-01', dateTo: '2026-10-31', page: 2, limit: 500 }, gerente);

    expect(modelo.find).toHaveBeenCalledWith({
      usuarioId: 'u1',
      tipo: 'ejecutivo',
      creadoEn: { $gte: new Date('2026-10-01T00:00:00.000Z'), $lte: new Date('2026-10-31T23:59:59.999Z') },
    });
    expect(consulta.skip).toHaveBeenCalledWith(100);
    expect(consulta.limit).toHaveBeenCalledWith(100);
    expect(p).toMatchObject({ total: 1, page: 2, limit: 100 });
  });

  it('un id mal formado es 400; uno inexistente, 404', async () => {
    const { servicio, modelo } = crear();
    await expect(servicio.obtener('abc', gerente)).rejects.toBeInstanceOf(BadRequestException);

    modelo.findById.mockResolvedValue(null);
    await expect(servicio.obtener(idValido, gerente)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('DOC-04: el reporte de otro usuario es 404 (no 403) para un Proveedor, y visible para el dueño y los internos', async () => {
    const { servicio, modelo } = crear();
    modelo.findById.mockResolvedValue(doc({ usuarioId: 'u-pa' }));

    await expect(servicio.obtener(idValido, provB)).rejects.toBeInstanceOf(NotFoundException);
    expect((await servicio.obtener(idValido, provA)).usuarioId).toBe('u-pa');
    expect((await servicio.obtener(idValido, gerente)).usuarioId).toBe('u-pa');
  });

  it('actualizar cambia el estado y guarda', async () => {
    const { servicio, modelo } = crear();
    const d = doc();
    modelo.findById.mockResolvedValue(d);

    const r = await servicio.actualizarEstado(idValido, { estado: 'exportado' }, gerente);

    expect(d.save).toHaveBeenCalled();
    expect(r.estado).toBe('exportado');
  });

  it('exportar genera el PDF del documento guardado, marca exportado y audita', async () => {
    const { servicio, modelo, pdf, audit } = crear();
    const d = doc();
    modelo.findById.mockResolvedValue(d);

    const { buffer, nombre } = await servicio.exportarPdf(idValido, gerente, 'Bearer t');

    expect(pdf.generar).toHaveBeenCalledWith(expect.objectContaining({ id: idValido }));
    expect(buffer.toString()).toContain('%PDF');
    expect(nombre).toBe('reporte-ejecutivo-2026-10-08.pdf');
    expect(d.estado).toBe('exportado');
    expect(audit.reportar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'exportar' }), 'Bearer t');
  });

  it('las estadísticas agrupan por usuario y mes; un Proveedor solo cuenta lo suyo', async () => {
    const { servicio, modelo } = crear();
    modelo.aggregate.mockResolvedValue([{ _id: { usuarioId: 'u-ger', mes: '2026-10' }, reportes: 3 }]);

    expect(await servicio.estadisticasPorUsuarioMes(gerente)).toEqual([{ usuarioId: 'u-ger', mes: '2026-10', reportes: 3 }]);
    expect(modelo.aggregate.mock.calls[0][0][0]).toHaveProperty('$group');

    await servicio.estadisticasPorUsuarioMes(provA);
    expect(modelo.aggregate.mock.calls[1][0][0]).toEqual({ $match: { usuarioId: 'u-pa' } });
  });
});
