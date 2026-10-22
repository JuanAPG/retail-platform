import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { AlgorithmsClient } from './algorithms-client.service';

const respuesta = (cuerpo: unknown, status = 200) => ({ ok: status < 400, status, json: async () => cuerpo });
const corrida = (id: string, status: 'completada' | 'fallida', algoritmo = 'apriori') => ({
  id,
  status,
  parameters: [{ runId: id, key: 'algoritmo', value: algoritmo }],
});
const REGLA = { id: 'r-1', support: 0.1, confidence: 0.7, lift: 2.5, items: [] };

/** Lectura de reglas de asociación en algorithms-core (D3). Sin red: `fetch` va simulado. */
describe('AlgorithmsClient', () => {
  const urlOriginal = process.env.ALGORITHMS_SERVICE_URL;
  const fetchOriginal = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    process.env.ALGORITHMS_SERVICE_URL = 'http://algorithms-core:3105';
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    global.fetch = fetchOriginal;
    if (urlOriginal === undefined) delete process.env.ALGORITHMS_SERVICE_URL;
    else process.env.ALGORITHMS_SERVICE_URL = urlOriginal;
  });

  it('toma la corrida completada más reciente (salta las fallidas) y reenvía el Authorization', async () => {
    fetchMock
      .mockResolvedValueOnce(respuesta({ data: [corrida('run-mala', 'fallida'), corrida('run-ok', 'completada', 'fpgrowth')] }))
      .mockResolvedValueOnce(respuesta({ id: 'run-ok', results: [REGLA] }));

    const resultado = await new AlgorithmsClient().reglasDeLaUltimaCorrida('tok');

    expect(resultado).toEqual({ runId: 'run-ok', algoritmo: 'fpgrowth', reglas: [REGLA] });
    const [[urlLista, opciones], [urlDetalle]] = fetchMock.mock.calls;
    expect(urlLista).toBe('http://algorithms-core:3105/v1/association/runs?page=1&limit=100');
    expect(urlDetalle).toBe('http://algorithms-core:3105/v1/association/runs/run-ok');
    expect(opciones.headers).toEqual({ Accept: 'application/json', Authorization: 'Bearer tok' });
  });

  it('sin corridas completadas devuelve null', async () => {
    fetchMock.mockResolvedValueOnce(respuesta({ data: [corrida('run-mala', 'fallida')] }));

    expect(await new AlgorithmsClient().reglasDeLaUltimaCorrida('Bearer tok')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('algorithms-core responde con error → 503 con el status en el mensaje', async () => {
    fetchMock.mockResolvedValueOnce(respuesta({ message: 'x' }, 403));

    await expect(new AlgorithmsClient().reglasDeLaUltimaCorrida('tok')).rejects.toThrow(
      new ServiceUnavailableException('No se pudieron leer las reglas de asociación: algorithms-core respondió 403.'),
    );
  });

  it('algorithms-core no responde → 503, nunca un 500 ni una lista vacía', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));

    await expect(new AlgorithmsClient().reglasDeLaUltimaCorrida('tok')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
