import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { sinSecretos } from '../../../common/interceptors/logging.interceptor';
import { AlmacenNoDisponibleError, conTope, motivoSeguro, TTL_DEFAULT_SEGUNDOS, TTL_MAXIMO_SEGUNDOS, ttlConfigurado } from './almacen';
import { crearAlmacen } from './crear-almacen';
import { GcsAlmacen } from './gcs.almacen';
import { LocalAlmacen } from './local.almacen';

describe('LocalAlmacen (doble del almacén)', () => {
  let carpeta: string;
  let almacen: LocalAlmacen;

  beforeEach(async () => {
    carpeta = await fs.mkdtemp(path.join(os.tmpdir(), 'alm-'));
    almacen = new LocalAlmacen(carpeta, 'secreto-de-prueba', 'http://localhost:3108/');
    delete process.env.ARCHIVOS_LOCAL_CAIDO;
  });
  afterEach(() => fs.rm(carpeta, { recursive: true, force: true }));

  it('guarda, reporta el tamaño y NO sobrescribe un objeto existente', async () => {
    const r = await almacen.guardar('reportes/a/b.pdf', Buffer.from('hola'));
    expect(r.tamanoBytes).toBe(4);
    expect(await almacen.tamano('reportes/a/b.pdf')).toBe(4);
    await expect(almacen.guardar('reportes/a/b.pdf', Buffer.from('otro'))).rejects.toBeInstanceOf(AlmacenNoDisponibleError);
    expect((await almacen.leer('reportes/a/b.pdf')).toString()).toBe('hola');
  });

  it('un objeto que no existe da null, no error', async () => {
    expect(await almacen.tamano('reportes/no-existe.pdf')).toBeNull();
  });

  it('rechaza rutas que salen de la carpeta', async () => {
    await expect(almacen.guardar('../fuera.txt', Buffer.from('x'))).rejects.toThrow('ruta fuera del almacén');
  });

  it('firma: válida dentro del TTL, inválida vencida, alterada o de otro archivo', async () => {
    const { url, expiraEn } = await almacen.firmarLectura('r.pdf', { ttlSegundos: 60, nombreDescarga: 'r.pdf', tipoContenido: 'application/pdf', archivoId: 'arch-1' });
    expect(url.startsWith('http://localhost:3108/v1/files/local/arch-1?exp=')).toBe(true);
    const q = new URL(url).searchParams;
    const exp = Number(q.get('exp'));
    const sig = q.get('sig')!;
    expect(exp).toBe(Math.floor(expiraEn.getTime() / 1000));
    expect(almacen.firmaValida('arch-1', exp, sig)).toBe(true);
    expect(almacen.firmaValida('arch-1', exp, sig, (exp + 1) * 1000)).toBe(false); // vencida
    expect(almacen.firmaValida('arch-2', exp, sig)).toBe(false); // otro archivo
    expect(almacen.firmaValida('arch-1', exp + 60, sig)).toBe(false); // exp alterado
    expect(almacen.firmaValida('arch-1', exp, sig.replace(/^./, sig[0] === 'a' ? 'b' : 'a'))).toBe(false);
    expect(almacen.firmaValida('arch-1', exp, 'no-hex')).toBe(false);
  });

  it('caído (ARCHIVOS_LOCAL_CAIDO) falla controlado y el health lo dice', async () => {
    process.env.ARCHIVOS_LOCAL_CAIDO = 'true';
    await expect(almacen.guardar('x.pdf', Buffer.from('x'))).rejects.toBeInstanceOf(AlmacenNoDisponibleError);
    expect(await almacen.verificar()).toMatch(/^error: /);
    delete process.env.ARCHIVOS_LOCAL_CAIDO;
    expect(await almacen.verificar()).toBe('ok');
  });
});

describe('crearAlmacen', () => {
  it('local por defecto, gcs con bucket, gcs sin bucket no arranca, valor raro tampoco', () => {
    expect(crearAlmacen({}).tipo).toBe('local');
    const gcs = crearAlmacen({ ARCHIVOS_ALMACEN: 'gcs', GCS_BUCKET_REPORTES: 'b-1' });
    expect(gcs.tipo).toBe('gcs');
    expect(gcs.bucket).toBe('b-1');
    expect(() => crearAlmacen({ ARCHIVOS_ALMACEN: 'gcs' })).toThrow('GCS_BUCKET_REPORTES');
    expect(() => crearAlmacen({ ARCHIVOS_ALMACEN: 's3' })).toThrow('"local" o "gcs"');
  });
});

describe('GcsAlmacen (con Storage simulado)', () => {
  function storageFalso(over: Partial<Record<'save' | 'getMetadata' | 'getSignedUrl' | 'bucketMeta', jest.Mock>> = {}) {
    const archivo = {
      save: over.save ?? jest.fn().mockResolvedValue(undefined),
      getMetadata: over.getMetadata ?? jest.fn().mockResolvedValue([{ size: '4', generation: '17' }]),
      getSignedUrl: over.getSignedUrl ?? jest.fn().mockResolvedValue(['https://storage.googleapis.com/b/o?X-Goog-Signature=abc']),
    };
    const bucket = { file: jest.fn().mockReturnValue(archivo), getMetadata: over.bucketMeta ?? jest.fn().mockResolvedValue([{}]) };
    return { storage: { bucket: jest.fn().mockReturnValue(bucket) } as never, archivo, bucket };
  }

  it('sube sin sobrescribir (ifGenerationMatch: 0), privado y con metadatos', async () => {
    const { storage, archivo } = storageFalso();
    const r = await new GcsAlmacen('b', storage).guardar('reportes/x.pdf', Buffer.from('hola'), 'application/pdf', { sha256: 'abc' });
    expect(r).toEqual({ tamanoBytes: 4, generacion: '17' });
    const [, opciones] = archivo.save.mock.calls[0];
    expect(opciones.preconditionOpts).toEqual({ ifGenerationMatch: 0 });
    expect(opciones.metadata.cacheControl).toBe('private, no-store');
    expect(opciones.metadata.metadata).toEqual({ sha256: 'abc' });
  });

  it('404 de GCS = objeto inexistente (null); otro error = no disponible', async () => {
    const no = storageFalso({ getMetadata: jest.fn().mockRejectedValue(Object.assign(new Error('No such object'), { code: 404 })) });
    expect(await new GcsAlmacen('b', no.storage).tamano('x')).toBeNull();
    const caido = storageFalso({ getMetadata: jest.fn().mockRejectedValue(Object.assign(new Error('ECONNRESET'), { code: 503 })) });
    await expect(new GcsAlmacen('b', caido.storage).tamano('x')).rejects.toBeInstanceOf(AlmacenNoDisponibleError);
  });

  it('firma V4 de lectura con el TTL y el nombre de descarga', async () => {
    const { storage, archivo } = storageFalso();
    const antes = Date.now();
    const r = await new GcsAlmacen('b', storage).firmarLectura('x', { ttlSegundos: 300, nombreDescarga: 'r.pdf', tipoContenido: 'application/pdf', archivoId: 'a' });
    const [op] = archivo.getSignedUrl.mock.calls[0];
    expect(op).toMatchObject({ version: 'v4', action: 'read', responseDisposition: 'attachment; filename="r.pdf"' });
    expect(r.expiraEn.getTime()).toBeGreaterThanOrEqual(antes + 300_000);
    expect(r.expiraEn.getTime()).toBeLessThanOrEqual(Date.now() + 300_000);
  });

  it('verificar no lanza: ok o el motivo sin URLs', async () => {
    expect(await new GcsAlmacen('b', storageFalso().storage).verificar()).toBe('ok');
    const malo = storageFalso({ bucketMeta: jest.fn().mockRejectedValue(new Error('denied https://x.y/z?sig=123')) });
    const v = await new GcsAlmacen('b', malo.storage).verificar();
    expect(v).toMatch(/^error: /);
    expect(v).not.toContain('https://');
  });
});

describe('utilidades', () => {
  it('TTL: 300 por defecto, tope 900, inválidos al defecto', () => {
    delete process.env.ARCHIVOS_URL_TTL_SEGUNDOS;
    expect(ttlConfigurado()).toBe(TTL_DEFAULT_SEGUNDOS);
    process.env.ARCHIVOS_URL_TTL_SEGUNDOS = '60';
    expect(ttlConfigurado()).toBe(60);
    process.env.ARCHIVOS_URL_TTL_SEGUNDOS = '99999';
    expect(ttlConfigurado()).toBe(TTL_MAXIMO_SEGUNDOS);
    process.env.ARCHIVOS_URL_TTL_SEGUNDOS = '-5';
    expect(ttlConfigurado()).toBe(TTL_DEFAULT_SEGUNDOS);
    delete process.env.ARCHIVOS_URL_TTL_SEGUNDOS;
  });

  it('conTope corta una promesa colgada', async () => {
    await expect(conTope(new Promise(() => undefined), 20, 'prueba')).rejects.toThrow('prueba: sin respuesta en 20 ms');
  });

  it('motivoSeguro y sinSecretos no dejan pasar firmas ni URLs', () => {
    expect(motivoSeguro(new Error('fallo en https://storage.googleapis.com/b/o?X-Goog-Signature=abc'))).toBe('fallo en [url]');
    expect(sinSecretos('/v1/files/local/a?exp=1&sig=deadbeef')).toBe('/v1/files/local/a?exp=1&sig=***');
    expect(sinSecretos('/v1/x?X-Goog-Signature=1&page=2')).toBe('/v1/x?X-Goog-Signature=***&page=2');
    expect(sinSecretos('/v1/reports?page=2')).toBe('/v1/reports?page=2');
  });
});
