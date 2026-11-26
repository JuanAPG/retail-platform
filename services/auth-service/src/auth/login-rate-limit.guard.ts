import { createHash } from 'node:crypto';
import {
  CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, ServiceUnavailableException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { getRedis } from '../common/auth/redis.client';

const RECORD_ATTEMPT = `
  local count = redis.call('INCR', KEYS[1])
  if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
  return { count, redis.call('TTL', KEYS[1]) }
`;

function positiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} debe ser un entero positivo.`);
  }
  return value;
}

@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  private readonly maxAttempts = positiveInteger('AUTH_LOGIN_MAX_ATTEMPTS', 15);
  private readonly windowSeconds = positiveInteger('AUTH_LOGIN_WINDOW_SECONDS', 60);

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const address = request.ip ?? request.socket.remoteAddress ?? 'desconocida';
    const key = createHash('sha256').update(address).digest('hex');

    let attempts: number;
    let remaining: number;
    try {
      [attempts, remaining] = await getRedis().eval(
        RECORD_ATTEMPT, 1, `auth:login:rate:${key}`, this.windowSeconds,
      ) as [number, number];
    } catch {
      throw new ServiceUnavailableException('No se pudo comprobar el límite de acceso. Intenta más tarde.');
    }

    if (attempts > this.maxAttempts) {
      http.getResponse<Response>().setHeader('Retry-After', Math.max(remaining, 1));
      throw new HttpException('Demasiados intentos de acceso. Intenta más tarde.', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}
