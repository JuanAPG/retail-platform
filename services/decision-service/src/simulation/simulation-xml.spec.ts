/**
 * Cuerpos XML en POST /v1/simulation/price y /presentation, en proceso:
 * controlador, SessionGuard, RolesGuard, middleware, interceptores,
 * ValidationPipe y filtro de errores REALES (los de `configurarApp`); solo
 * se simulan Redis y el SimulationService (sin base de datos).
 * Los XML de ejemplo y los errores XML se validan contra el XSD oficial
 * (`docs/contratos/decision-service.xsd`) con libxml2 (xmllint-wasm).
 */
import { INestApplication, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { readFileSync } from 'fs';
import { AddressInfo } from 'net';
import { resolve } from 'path';
import { validateXML } from 'xmllint-wasm';
import { SessionGuard } from '../common/auth/session.guard';
import { configurarApp } from '../configurar-app';
import { SimulationController, EJEMPLO_XML_PRECIO, EJEMPLO_XML_PRESENTACION } from './simulation.controller';
import { registrarCuerpoXml } from './simulation.module';
import { SimulationService } from './simulation.service';

jest.mock('../common/auth/redis.client', () => ({
  // Sesión activa para todos; ningún token revocado.
  getRedis: () => ({ exists: async (clave: string) => (clave.startsWith('session:') ? 1 : 0) }),
}));

const SECRETO = 'secreto-solo-para-pruebas';
const RAIZ_REPO = resolve(__dirname, '../../../..');
const XSD = resolve(RAIZ_REPO, 'docs/contratos/decision-service.xsd');
const CONTRATO_MD = resolve(RAIZ_REPO, 'docs/contratos/decision-service.md');

async function erroresXsd(xml: string): Promise<string[]> {
  const r = await validateXML({
    xml: [{ fileName: 'documento.xml', contents: xml }],
    schema: [{ fileName: 'decision-service.xsd', contents: readFileSync(XSD, 'utf8') }],
  });
  return r.valid ? [] : r.errors.map((e) => e.rawMessage.trim());
}

const UUID_P = '8f14e45f-ceea-467a-9f3b-1c2d3e4f5a6b';
const UUID_Z = '3c59dc04-8a1f-4d2e-b7c6-5e4f3a2b1c0d';

/** Respuesta con la forma de `simulacionPrecioResponse` (para validar la ida y vuelta en XML). */
const RESULTADO_PRECIO = {
  type: 'price',
  productId: 'a87ff679-a2f3-471d-8c3e-9b8a7c6d5e4f',
  presentationId: UUID_P,
  zoneId: UUID_Z,
  inputs: { currentPrice: 28.5, newPrice: 25.5, baseDemand: 100, elasticity: -1.2, elasticityRunId: 'corrida' },
  results: [{ indicatorKey: 'demanda_estimada', zoneId: UUID_Z, baseValue: 100, simulatedValue: 112.4 }],
  scenarioId: 'escenario',
};

describe('POST /v1/simulation/* con cuerpo XML (en proceso)', () => {
  let app: INestApplication;
  let base: string;
  const servicio = {
    simulatePriceChange: jest.fn(async (_dto: object) => RESULTADO_PRECIO),
    simulatePresentationChange: jest.fn(async (_dto: object) => ({ type: 'presentacion' })),
  };
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = SECRETO;
    process.env.XML_NAMESPACE = 'decision/v1';

    @Module({
      imports: [JwtModule.register({})],
      controllers: [SimulationController],
      providers: [SessionGuard, { provide: SimulationService, useValue: servicio }],
    })
    class ModuloPrueba implements NestModule {
      configure(consumer: MiddlewareConsumer) {
        registrarCuerpoXml(consumer); // el mismo registro que SimulationModule
      }
    }

    app = await NestFactory.create(ModuloPrueba, { logger: false });
    configurarApp(app);
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;

    const jwt = new JwtService();
    for (const [nombre, rol] of [['planeador', 'Planeador'], ['analista', 'Analista comercial']]) {
      tokens[nombre] = await jwt.signAsync({ sub: `id-${nombre}`, email: `${nombre}@x.mx`, rol, rolId: 1, jti: nombre }, { secret: SECRETO });
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => jest.clearAllMocks());

  async function post(
    ruta: string,
    cuerpo: string,
    { tipo = 'application/xml', accept = 'application/xml', token = tokens.planeador as string | null } = {},
  ) {
    const r = await fetch(`${base}/v1/simulation/${ruta}`, {
      method: 'POST',
      headers: { 'Content-Type': tipo, Accept: accept, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: cuerpo,
    });
    return { estado: r.status, texto: await r.text(), tipo: r.headers.get('content-type') ?? '' };
  }

  /** El error transversal en XML: raíz `<error>`, valida contra el XSD; devuelve su `message`. */
  async function errorXml(r: { estado: number; texto: string }, estado: number): Promise<string> {
    expect(r.estado).toBe(estado);
    expect(await erroresXsd(r.texto)).toEqual([]);
    expect(r.texto).toMatch(/<error xmlns="decision\/v1">/);
    expect(r.texto).toContain(`<statusCode>${estado}</statusCode>`);
    expect(r.texto).toContain('<code>VALIDATION_ERROR</code>');
    return /<message>([^<]*)<\/message>/.exec(r.texto)?.[1] ?? '';
  }

  describe('ejemplos del contrato', () => {
    it.each([
      ['simulacionPrecioRequest', EJEMPLO_XML_PRECIO],
      ['simulacionPresentacionRequest', EJEMPLO_XML_PRESENTACION],
    ])('%s valida contra el XSD oficial y está en el .md del contrato', async (_raiz, xml) => {
      expect(await erroresXsd(xml)).toEqual([]);
      expect(readFileSync(CONTRATO_MD, 'utf8').replace(/\r\n/g, '\n')).toContain(xml);
    });
  });

  describe('XML válido', () => {
    it('price: llega al servicio el mismo DTO que con JSON, y la respuesta XML valida', async () => {
      const r = await post('price', EJEMPLO_XML_PRECIO);
      expect(r.estado).toBe(201);
      expect(await erroresXsd(r.texto)).toEqual([]);
      const dtoXml = servicio.simulatePriceChange.mock.calls[0][0];

      const j = await post('price', JSON.stringify({ presentationId: UUID_P, zoneId: UUID_Z, newPrice: 25.5 }), {
        tipo: 'application/json',
        accept: 'application/json',
      });
      expect(j.estado).toBe(201);
      expect(JSON.parse(j.texto)).toEqual(RESULTADO_PRECIO);
      const dtoJson = servicio.simulatePriceChange.mock.calls[1][0];

      expect(dtoXml).toEqual(dtoJson);
      expect(dtoXml).toEqual({ presentationId: UUID_P, zoneId: UUID_Z, newPrice: 25.5 });
      expect(dtoXml.constructor.name).toBe('PriceSimulationDto');
    });

    it('text/xml con charset y Accept JSON también funciona', async () => {
      const r = await post('price', EJEMPLO_XML_PRECIO, { tipo: 'text/xml; charset=utf-8', accept: 'application/json' });
      expect(r.estado).toBe(201);
      expect(r.tipo).toMatch(/application\/json/);
    });

    it('presentation: la lista <item> llega como arreglo', async () => {
      const r = await post('presentation', EJEMPLO_XML_PRESENTACION);
      expect(r.estado).toBe(201);
      expect(servicio.simulatePresentationChange.mock.calls[0][0]).toEqual({
        productId: 'a87ff679-a2f3-471d-8c3e-9b8a7c6d5e4f',
        zoneId: UUID_Z,
        presentationIds: [
          'e4da3b7f-bbce-4345-9777-2b0674a318d5',
          '1679091c-5a88-4faf-afb5-e6087eb1b2dc',
          '8f14e45f-ceea-467a-9f3b-1c2d3e4f5a6c',
        ],
      });
    });
  });

  describe('XML que no sirve → 400 con el error transversal en XML', () => {
    it.each([
      ['raíz equivocada', EJEMPLO_XML_PRECIO.replace(/simulacionPrecioRequest/g, 'simulacionRequest'), /raíz del XML/],
      ['namespace equivocado', EJEMPLO_XML_PRECIO.replace('xmlns="decision/v1"', 'xmlns="pricing/v1"'), /namespace/],
      ['sin namespace', EJEMPLO_XML_PRECIO.replace(' xmlns="decision/v1"', ''), /falta xmlns/],
      ['mal formado', EJEMPLO_XML_PRECIO.replace('</newPrice>', '</precio>'), /mal formado/],
      [
        'DOCTYPE con entidad externa',
        EJEMPLO_XML_PRECIO.replace('<simulacionPrecioRequest', '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]>\n<simulacionPrecioRequest').replace(
          '<zoneId>',
          '<zoneId>&e;',
        ),
        /DOCTYPE/,
      ],
      ['cuerpo vacío', '', /vacío/],
    ])('%s', async (_caso, xml, esperado) => {
      const r = await post('price', xml);
      expect(await errorXml(r, 400)).toMatch(esperado);
      expect(servicio.simulatePriceChange).not.toHaveBeenCalled();
    });

    it('XML válido que no cumple el DTO: el mismo 400 (con el mismo details) que el JSON', async () => {
      const xml = EJEMPLO_XML_PRECIO.replace(UUID_Z, 'no-es-uuid').replace('25.50', 'abc').replace(
        '</simulacionPrecioRequest>',
        '<extra>1</extra></simulacionPrecioRequest>',
      );
      const rx = await post('price', xml, { accept: 'application/json' });
      const rj = await post('price', JSON.stringify({ presentationId: UUID_P, zoneId: 'no-es-uuid', newPrice: 'abc', extra: '1' }), {
        tipo: 'application/json',
        accept: 'application/json',
      });
      expect(rx.estado).toBe(400);
      expect(rj.estado).toBe(400);
      expect(JSON.parse(rx.texto).details).toEqual(JSON.parse(rj.texto).details);
      expect(JSON.parse(rx.texto).details).toEqual(
        expect.arrayContaining(['extra no es un parámetro permitido.', 'zoneId must be a UUID']),
      );
    });

    it('presentation con un solo <item> → 400 de D-14 (mínimo 3), igual que en JSON', async () => {
      const xml = EJEMPLO_XML_PRESENTACION.replace(/\s*<item>1679091c[^<]*<\/item>\s*<item>8f14e45f[^<]*<\/item>/, '');
      const r = await post('presentation', xml, { accept: 'application/json' });
      expect(r.estado).toBe(400);
      expect(JSON.parse(r.texto).details).toContain('presentationIds debe traer al menos 3 presentaciones (D-14).');
    });
  });

  it('cuerpo XML de más de 1 MB → 413', async () => {
    const relleno = `<!--${'x'.repeat(1024 * 1024)}-->`;
    const r = await post('price', EJEMPLO_XML_PRECIO.replace('<newPrice>', `${relleno}<newPrice>`));
    expect(await errorXml(r, 413)).toMatch(/1 MB/);
    expect(servicio.simulatePriceChange).not.toHaveBeenCalled();
  });

  it.each(['text/plain', 'application/x-www-form-urlencoded'])('Content-Type %s → 415', async (tipo) => {
    const r = await post('price', 'presentationId=x', { tipo });
    expect(await errorXml(r, 415)).toMatch(/no soportado/);
  });

  it('sin sesión → 401 aunque el XML venga mal (el XML no se lee antes de autenticar)', async () => {
    const r = await post('price', '<roto', { token: null });
    expect(r.estado).toBe(401);
    expect(await erroresXsd(r.texto)).toEqual([]);
    expect(r.texto).toContain('<code>UNAUTHORIZED</code>');
  });

  it('rol sin permiso (Analista) → 403 aunque el XML venga bien o mal', async () => {
    for (const xml of [EJEMPLO_XML_PRECIO, '<roto']) {
      const r = await post('price', xml, { token: tokens.analista });
      expect(r.estado).toBe(403);
      expect(await erroresXsd(r.texto)).toEqual([]);
      expect(r.texto).toContain('<code>FORBIDDEN</code>');
    }
    expect(servicio.simulatePriceChange).not.toHaveBeenCalled();
  });

  it('JSON sigue igual: un JSON mal formado da el 400 de siempre', async () => {
    const r = await post('price', '{"newPrice": ', { tipo: 'application/json', accept: 'application/json' });
    expect(r.estado).toBe(400);
    expect(JSON.parse(r.texto).code).toBe('VALIDATION_ERROR');
  });
});
