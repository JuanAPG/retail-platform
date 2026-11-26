import { ExecutionContext } from '@nestjs/common';
import * as redis from '../common/auth/redis.client';
import { LoginRateLimitGuard } from './login-rate-limit.guard';

function solicitud() {
  const setHeader = jest.fn();
  const context = {
    switchToHttp: () => ({
      getRequest: () => ({ ip: '192.0.2.42' }),
      getResponse: () => ({ setHeader }),
    }),
  } as unknown as ExecutionContext;
  return { context, setHeader };
}

afterEach(() => jest.restoreAllMocks());

it('permite intentos dentro de la ventana y retorna 429 con Retry-After al excederla', async () => {
  const evalCommand = jest.fn().mockResolvedValueOnce([1, 60]).mockResolvedValueOnce([16, 34]);
  jest.spyOn(redis, 'getRedis').mockReturnValue({ eval: evalCommand } as never);
  const rateLimit = new LoginRateLimitGuard();
  const { context, setHeader } = solicitud();

  await expect(rateLimit.canActivate(context)).resolves.toBe(true);
  await expect(rateLimit.canActivate(context)).rejects.toMatchObject({ status: 429 });
  expect(setHeader).toHaveBeenCalledWith('Retry-After', 34);
  expect(evalCommand.mock.calls[0][2]).toMatch(/^auth:login:rate:[a-f0-9]{64}$/);
});

it('responde 503 cuando Redis no puede contar el intento', async () => {
  const evalCommand = jest.fn().mockRejectedValue(new Error('Redis no responde'));
  jest.spyOn(redis, 'getRedis').mockReturnValue({ eval: evalCommand } as never);
  await expect(new LoginRateLimitGuard().canActivate(solicitud().context)).rejects.toMatchObject({ status: 503 });
});
