export const SERVICES = [
  'auth-service', 'catalog-service', 'pricing-service', 'core-process-service',
  'algorithms-core', 'analytics-stats', 'decision-service', 'documents-service',
  'notifications-service', 'audit-service', 'transactions-ingestion-service',
  'income-segmentation-service', 'basket-analysis-service', 'availability-service',
  'promotion-service', 'demand-forecast-service', 'recommendations-workflow-service',
  'offline-sync-service', 'data-governance-service', 'monitoring-service',
] as const;

export type ServiceName = (typeof SERVICES)[number];

export interface Target {
  service: ServiceName;
  port: number;
  url: string;
}

export function targets(): Target[] {
  const configured = JSON.parse(process.env.MONITOR_TARGETS ?? '{}') as Record<string, unknown>;
  if (!configured || typeof configured !== 'object' || Array.isArray(configured)) {
    throw new Error('MONITOR_TARGETS debe ser un objeto con orígenes HTTP por servicio.');
  }
  for (const service of Object.keys(configured)) {
    if (!SERVICES.some((known) => known === service)) {
      throw new Error(`Servicio desconocido en MONITOR_TARGETS: ${service}`);
    }
  }
  return SERVICES.map((service, index) => {
    const port = 3101 + index;
    const local = process.env.PORT ?? String(port);
    const origin = configured[service] ?? (
      service === 'monitoring-service' ? `http://127.0.0.1:${local}` : `http://${service}:${port}`
    );
    if (typeof origin !== 'string') throw new Error(`Origen inválido para ${service}.`);
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.pathname !== '/' ||
        parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error(`Usa un origen HTTP sin ruta, credenciales ni consulta para ${service}.`);
    }
    return { service, port, url: new URL('/v1/health', parsed).href };
  });
}
