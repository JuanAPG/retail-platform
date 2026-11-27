import { cuerpoDeLinaje, FUENTE_VENTAS, LineageReporter } from './lineage-reporter.service';

const CORRIDA = {
  runId: '28042f76-b273-423c-9a33-0dbe23c101ea',
  foto: '5aedd3fed9841f6b76d495b41909268785444dc3ad36a92854c538405338ebb7',
  descripcion: 'Apriori con soporte ≥ 0.01 y confianza ≥ 0.3 sobre 10006 canasta(s), 2025-11-24 a 2026-11-22',
  fecha: new Date('2026-11-27T07:20:00.000Z'),
};

describe('LineageReporter (D-43, contrato de data-governance)', () => {
  const original = { url: process.env.DATA_GOVERNANCE_SERVICE_URL, fetch: global.fetch };
  afterEach(() => {
    process.env.DATA_GOVERNANCE_SERVICE_URL = original.url;
    global.fetch = original.fetch;
  });

  it('el cuerpo: corrida de algorithms-core, fuente ventas-core-process y la foto como versión (DG-3, DG-4)', () => {
    expect(cuerpoDeLinaje(CORRIDA)).toEqual({
      service: 'algorithms-core',
      resourceType: 'corrida',
      resourceId: CORRIDA.runId,
      description: CORRIDA.descripcion,
      source: { key: FUENTE_VENTAS, version: CORRIDA.foto },
      occurredAt: '2026-11-27T07:20:00.000Z',
    });
    expect(FUENTE_VENTAS).toBe('ventas-core-process');
  });

  it('la descripción se corta a 300 caracteres (límite del contrato)', () => {
    expect(cuerpoDeLinaje({ ...CORRIDA, descripcion: 'x'.repeat(400) }).description).toHaveLength(300);
  });

  it('POST a /v1/lineage con el token del usuario y el X-Correlation-Id', async () => {
    process.env.DATA_GOVERNANCE_SERVICE_URL = 'http://data-governance-service:3119';
    const fetchFalso = jest.fn().mockResolvedValue({ ok: true, status: 201 });
    global.fetch = fetchFalso as unknown as typeof fetch;

    await new LineageReporter().registrar(CORRIDA, 'token-sin-prefijo', 'corr-1');

    const [url, opciones] = fetchFalso.mock.calls[0];
    expect(url).toBe('http://data-governance-service:3119/v1/lineage');
    expect(opciones.method).toBe('POST');
    expect(opciones.headers).toMatchObject({ Authorization: 'Bearer token-sin-prefijo', 'X-Correlation-Id': 'corr-1' });
    expect(JSON.parse(opciones.body)).toEqual(cuerpoDeLinaje(CORRIDA));
  });

  it('sin DATA_GOVERNANCE_SERVICE_URL no llama a nadie', async () => {
    delete process.env.DATA_GOVERNANCE_SERVICE_URL;
    const fetchFalso = jest.fn();
    global.fetch = fetchFalso as unknown as typeof fetch;
    await new LineageReporter().registrar(CORRIDA, 't');
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('nunca lanza: ni con data-governance caído ni con un 409', async () => {
    process.env.DATA_GOVERNANCE_SERVICE_URL = 'http://data-governance-service:3119';
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;
    await expect(new LineageReporter().registrar(CORRIDA, 't')).resolves.toBeUndefined();
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 409 }) as unknown as typeof fetch;
    await expect(new LineageReporter().registrar(CORRIDA, 't')).resolves.toBeUndefined();
  });
});
