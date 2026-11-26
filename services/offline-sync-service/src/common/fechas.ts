/**
 * Días locales del negocio (contrato §3): `YYYY-MM-DD` es el día de
 * America/Monterrey (variable `BUSINESS_TIMEZONE`), igual que audit-service.
 */

const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

export function zonaNegocio(): string {
  return process.env.BUSINESS_TIMEZONE ?? 'America/Monterrey';
}

/** `true` si es `YYYY-MM-DD` y la fecha existe (rechaza 2026-02-30). */
export function esFechaValida(fecha: string): boolean {
  const m = FECHA.exec(fecha);
  if (!m) return false;
  const [y, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const fechaUtc = new Date(Date.UTC(y, mes - 1, d));
  return fechaUtc.getUTCFullYear() === y && fechaUtc.getUTCMonth() === mes - 1 && fechaUtc.getUTCDate() === d;
}

/** Minutos que la zona va adelante de UTC en ese instante (Monterrey: −360). */
function desfaseMinutos(ms: number, zona: string): number {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: zona,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ms));
  const valor = (tipo: string) => Number(partes.find((p) => p.type === tipo)!.value);
  const comoUtc = Date.UTC(valor('year'), valor('month') - 1, valor('day'), valor('hour'), valor('minute'), valor('second'));
  return Math.round((comoUtc - ms) / 60000);
}

/** Instante UTC en que empieza el día local `fecha` en la zona del negocio. */
export function inicioDelDia(fecha: string, zona = zonaNegocio()): Date {
  const [y, m, d] = fecha.split('-').map(Number);
  const medianocheUtc = Date.UTC(y, m - 1, d);
  let instante = medianocheUtc - desfaseMinutos(medianocheUtc, zona) * 60000;
  // Si justo ese día cambia el horario, se recalcula con el desfase real.
  const real = desfaseMinutos(instante, zona);
  instante = medianocheUtc - real * 60000;
  return new Date(instante);
}

/** Instante UTC en que empieza el día SIGUIENTE (límite exclusivo de un `dateTo` inclusivo). */
export function finDelDia(fecha: string, zona = zonaNegocio()): Date {
  const [y, m, d] = fecha.split('-').map(Number);
  const siguiente = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return inicioDelDia(siguiente, zona);
}
