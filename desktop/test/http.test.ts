import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, errorDeRespuesta, http, pedir } from '../src/api/httpClient';
import { importarDesdeObjeto } from '../src/api/ingestionApi';
import { login } from '../src/api/authApi';
import { XSD, erroresXsd, fixture } from './apoyo';

/**
 * El cliente HTTP en ejecución, con un adaptador falso en lugar de la red: qué manda (Accept,
 * Content-Type, cuerpo) y cómo trata cada respuesta (XML válido, raíz o namespace equivocados,
 * éxito en JSON, errores en XML o en JSON, sin red).
 */

interface Respuesta {
  status: number;
  tipo?: string;
  cuerpo?: string;
}

let enviado: InternalAxiosRequestConfig[] = [];
let siguiente: Respuesta | 'sin-red' = { status: 200 };
const adaptadorOriginal = http.defaults.adapter;

const falso: AxiosAdapter = async (config) => {
  enviado.push(config);
  if (siguiente === 'sin-red') {
    const e: any = new Error('Network Error');
    e.isAxiosError = true;
    e.config = config;
    e.code = 'ERR_NETWORK';
    throw e;
  }
  const r = { data: siguiente.cuerpo ?? '', status: siguiente.status, statusText: '', headers: { 'content-type': siguiente.tipo ?? '' }, config };
  if (r.status >= 400) {
    const e: any = new Error(`Request failed with status code ${r.status}`);
    e.isAxiosError = true;
    e.config = config;
    e.response = r;
    throw e;
  }
  return r;
};

beforeAll(() => {
  http.defaults.adapter = falso;
  vi.stubEnv('VITE_AUTH_URL', 'http://auth.prueba/');
  vi.stubEnv('VITE_SEGMENTATION_URL', 'http://seg.prueba/');
  vi.stubEnv('VITE_INGESTION_URL', 'http://ing.prueba/');
});

afterAll(() => {
  http.defaults.adapter = adaptadorOriginal;
  vi.unstubAllEnvs();
});

beforeEach(() => {
  enviado = [];
});

const xml = (cuerpo: string, status = 200): Respuesta => ({ status, tipo: 'application/xml; charset=utf-8', cuerpo });

describe('pedir: respuestas exitosas', () => {
  it('pide XML, manda JSON a auth-service (no lee XML) y devuelve la raíz validada', async () => {
    siguiente = xml(fixture('auth-login.xml'));
    const r = await login('a@b.c', 'secreto');
    expect(r.usuario.rol).toBe('Analista comercial');
    const req = enviado[0];
    expect(req.baseURL).toBe('http://auth.prueba/');
    expect(req.url).toBe('v1/auth/login');
    expect(req.headers.Accept).toBe('application/xml');
    expect(req.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(req.data)).toEqual({ email: 'a@b.c', password: 'secreto' });
  });

  it('manda XML real donde el contrato lo acepta (objectImport a ingesta) y ese XML valida contra el XSD', async () => {
    siguiente = xml(fixture('ingestion-import.xml'), 201);
    const lote = await importarDesdeObjeto('ingestion/incoming/01/demo.csv', '1764000000000000');
    expect(lote.state).toBe('vista_previa');
    const req = enviado[0];
    expect(req.headers['Content-Type']).toBe('application/xml');
    expect(req.data).toContain('<objectImport xmlns="ingestion/v1">');
    expect(await erroresXsd(req.data, XSD.ingestion)).toEqual([]);
  });

  it('rechaza un éxito en JSON (el escritorio es XML exclusivo)', async () => {
    siguiente = { status: 200, tipo: 'application/json', cuerpo: '{"accessToken":"x"}' };
    await expect(pedir({ servicio: 'auth', ruta: 'v1/auth/login', raiz: 'loginResponse' })).rejects.toMatchObject({
      code: 'RESPUESTA_NO_XML',
    });
  });

  it('rechaza una raíz o un namespace fuera de contrato', async () => {
    siguiente = xml(fixture('auth-validate.xml'));
    await expect(pedir({ servicio: 'auth', ruta: 'x', raiz: 'loginResponse' })).rejects.toMatchObject({ code: 'XML_FUERA_DE_CONTRATO' });
    siguiente = xml(fixture('segmentation-segments.xml'));
    await expect(pedir({ servicio: 'auth', ruta: 'x', raiz: 'segmentListResponse' })).rejects.toThrow(/namespace/);
  });

  it('un 204 sin cuerpo (DELETE de segmento) no exige raíz', async () => {
    siguiente = { status: 204 };
    await expect(pedir({ servicio: 'segmentation', metodo: 'DELETE', ruta: 'v1/segments/1', raiz: null })).resolves.toBeUndefined();
  });
});

describe('pedir: errores en XML o en JSON', () => {
  it('error en XML (<error> del filtro de la plantilla), con detalle', async () => {
    siguiente = xml(fixture('segmentation-error-400.xml'), 400);
    const e = await pedir({ servicio: 'segmentation', metodo: 'PATCH', ruta: 'v1/segments/1', json: {}, raiz: 'segmentResponse' }).catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', servicio: 'income-segmentation-service' });
    expect(e.details).toEqual(['incomeRangeMin se encima con ING_2']);
  });

  it('error en JSON (servicio o proxy que no responde XML), con message como lista', async () => {
    siguiente = {
      status: 403,
      tipo: 'application/json',
      cuerpo: JSON.stringify({ statusCode: 403, message: ['Tu rol no puede calcular.'], code: 'FORBIDDEN', path: '/v1/x', timestamp: 't' }),
    };
    const e = await pedir({ servicio: 'auth', ruta: 'x', raiz: 'loginResponse' }).catch((x) => x);
    expect(e).toMatchObject({ status: 403, code: 'FORBIDDEN', message: 'Tu rol no puede calcular.' });
  });

  it('error sin cuerpo o ilegible: mensaje genérico con el código HTTP', async () => {
    siguiente = { status: 502, tipo: 'text/html', cuerpo: '<html><body>Bad gateway</body></html>' };
    const e = await pedir({ servicio: 'auth', ruta: 'x', raiz: 'loginResponse' }).catch((x) => x);
    expect(e).toMatchObject({ status: 502, code: 'HTTP_502' });
  });

  it('sin red: código NETWORK (AuthContext no cierra la sesión por esto)', async () => {
    siguiente = 'sin-red';
    const e = await pedir({ servicio: 'auth', ruta: 'x', raiz: 'loginResponse' }).catch((x) => x);
    expect(e).toMatchObject({ status: 0, code: 'NETWORK' });
  });

  it('errorDeRespuesta: XML de error de ingesta (413)', () => {
    const e = errorDeRespuesta(413, 'application/xml', fixture('ingestion-error-413.xml'), 'transactions-ingestion-service');
    expect(e).toMatchObject({ status: 413, code: 'VALIDATION_ERROR' });
  });
});
