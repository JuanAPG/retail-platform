import { performance } from 'node:perf_hooks';
import { Target } from './targets';

export type Status = 'operativo' | 'degradado' | 'caido' | 'sin_datos';
export type DependencyStatus = 'ok' | 'no configurado' | 'error';

export interface Dependency {
  name: string;
  status: DependencyStatus;
  latencyMs: number | null;
}

export interface ServiceCheck {
  service: Target['service'];
  port: number;
  version: string | null;
  status: Status;
  checkedAt: Date | null;
  latencyMs: number | null;
  probeErrorsConsecutive: number;
  dependencies: Dependency[];
}

interface HealthResult {
  status?: unknown;
  version?: unknown;
  checks?: unknown;
  latencyMs?: unknown;
}

const DEPENDENCIES = ['postgres', 'mongodb', 'redis', 'bucket'];
const SLOW_MS = 1000;
const TIMEOUT_MS = 3000;

export function emptyCheck(target: Target): ServiceCheck {
  return {
    service: target.service,
    port: target.port,
    version: null,
    status: 'sin_datos',
    checkedAt: null,
    latencyMs: null,
    probeErrorsConsecutive: 0,
    dependencies: [],
  };
}

function object(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function dependenciesFor(health: HealthResult): Dependency[] {
  const checks = object(health.checks);
  const latencies = object(health.latencyMs);
  const names = new Set([...DEPENDENCIES, ...Object.keys(checks)]);
  return [...names].map((name) => {
    const check = checks[name];
    const status = check === 'ok' || check === 'no configurado'
      ? check
      : check === undefined ? 'no configurado' : 'error';
    const reported = latencies[name];
    const latencyMs = typeof reported === 'number' && Number.isFinite(reported) && reported >= 0
      ? Math.round(reported)
      : status === 'no configurado' ? 0 : null;
    return { name, status, latencyMs };
  });
}

export async function probe(target: Target, previous: ServiceCheck): Promise<ServiceCheck> {
  const started = performance.now();
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const elapsed = () => Math.round(performance.now() - started);
  try {
    const response = await fetch(target.url, {
      signal,
      redirect: 'error',
      headers: { Accept: 'application/json' },
    });
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new Error('HTTP inesperado en health.');
    }
    const health = object(await response.json());
    if (health.status !== 'ok' && health.status !== 'degraded') {
      throw new Error('Estado inválido en health.');
    }
    const latencyMs = elapsed();
    const dependencies = dependenciesFor(health);
    const degraded = health.status === 'degraded' || latencyMs > SLOW_MS ||
      dependencies.some((item) => item.status === 'error' || (item.latencyMs ?? 0) > SLOW_MS);
    return {
      ...emptyCheck(target),
      version: typeof health.version === 'string' ? health.version : null,
      status: degraded ? 'degradado' : 'operativo',
      checkedAt: new Date(),
      latencyMs,
      dependencies,
    };
  } catch {
    const probeErrorsConsecutive = previous.probeErrorsConsecutive + 1;
    return {
      ...emptyCheck(target),
      version: previous.version,
      status: signal.aborted || probeErrorsConsecutive >= 2 ? 'caido' : 'degradado',
      checkedAt: new Date(),
      latencyMs: elapsed(),
      probeErrorsConsecutive,
    };
  }
}
