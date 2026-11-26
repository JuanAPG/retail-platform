import { emptyCheck, probe } from './probe';
import { Target } from './targets';

const target: Target = { service: 'auth-service', port: 3101, url: 'http://127.0.0.1:3101/v1/health' };

afterEach(() => jest.restoreAllMocks());

it('distingue una dependencia lenta de un error del sondeo', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue(Response.json({
    status: 'ok',
    version: 'test',
    checks: { redis: 'ok', mongodb: 'no configurado' },
    latencyMs: { redis: 1001 },
  }));
  const result = await probe(target, emptyCheck(target));
  expect(result).toMatchObject({ status: 'degradado', version: 'test', probeErrorsConsecutive: 0 });
  expect(result.dependencies).toContainEqual({ name: 'redis', status: 'ok', latencyMs: 1001 });
  expect(result.dependencies).toContainEqual({ name: 'mongodb', status: 'no configurado', latencyMs: 0 });
});

it('marca caída tras dos errores y vuelve a operativo tras un éxito', async () => {
  const fetch = jest.spyOn(global, 'fetch')
    .mockRejectedValueOnce(new Error('conexión rechazada'))
    .mockResolvedValueOnce(new Response(null, { status: 500 }))
    .mockResolvedValueOnce(Response.json({ status: 'ok', checks: { redis: 'ok' } }));
  const first = await probe(target, emptyCheck(target));
  const second = await probe(target, first);
  const recovered = await probe(target, second);
  expect(first).toMatchObject({ status: 'degradado', probeErrorsConsecutive: 1 });
  expect(second).toMatchObject({ status: 'caido', probeErrorsConsecutive: 2 });
  expect(recovered).toMatchObject({ status: 'operativo', probeErrorsConsecutive: 0 });
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('marca caída desde el primer timeout', async () => {
  jest.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort());
  jest.spyOn(global, 'fetch').mockRejectedValue(new Error('timeout'));
  const result = await probe(target, emptyCheck(target));
  expect(result).toMatchObject({ status: 'caido', probeErrorsConsecutive: 1 });
});
