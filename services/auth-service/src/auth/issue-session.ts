import { UnauthorizedException } from '@nestjs/common';
import { getRedis } from '../common/auth/redis.client';

const SAVE = `
  if redis.call('EXISTS', KEYS[1]) == 1 or (redis.call('GET', KEYS[2]) or '') ~= ARGV[1] then return 0 end
  if ARGV[2] ~= '' and redis.call('GET', KEYS[3]) ~= ARGV[2] then return 0 end
  local time = redis.call('TIME')
  local now = tonumber(time[1])
  redis.call('ZREMRANGEBYSCORE', KEYS[4], '-inf', now)
  redis.call('ZADD', KEYS[4], now + tonumber(ARGV[5]), ARGV[4])
  redis.call('EXPIRE', KEYS[4], ARGV[5])
  redis.call('SET', KEYS[3], ARGV[3], 'EX', ARGV[6])
  return 1
`;

export async function saveSession(id: string, epoch: string, tokens: { accessJti: string; refreshJti: string },
  accessTtl: number, refreshTtl: number, previous = '') {
  const result = await getRedis().eval(SAVE, 4, `auth:recovery:busy:${id}`, `auth:recovery:epoch:${id}`,
    `session:${id}`, `auth:issued:${id}`, epoch, previous,
    JSON.stringify({ refreshJti: tokens.refreshJti, accessJti: tokens.accessJti }),
    tokens.accessJti, accessTtl, refreshTtl);
  if (!result) throw new UnauthorizedException('La sesión cambió. Vuelve a iniciar sesión.');
}
