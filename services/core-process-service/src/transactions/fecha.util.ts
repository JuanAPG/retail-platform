import { ZONA_HORARIA } from '../common/zona-horaria';

/**
 * Fechas y números de M06, compartidos por el alta manual y el CSV para
 * que las dos puertas de entrada apliquen la MISMA regla.
 *
 * Antes la validación de fecha futura comparaba cadenas
 * (`texto.slice(0,10) > hoy`), así que `"12/31/2099"` pasaba como válida:
 * `"1" < "2"`. Aquí se compara el instante ya interpretado.
 *
 * Y una fecha sin huso se interpreta en `ZONA_HORARIA`, no en UTC: quien
 * captura una venta escribe la hora de aquí.
 */

/** `2026-09-01` o `2026-09-01 10:30` / `2026-09-01T10:30[:ss[.mmm]]`, sin huso. */
const SIN_HUSO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?$/;

/** `2026-09`: una venta necesita día, no solo mes. */
const SIN_DIA = /^\d{4}-\d{2}$/;

/**
 * Fecha con huso EXPLÍCITO: `2026-09-01T10:00:00Z`, `...-06:00`,
 * `...+02:00`. Solo estas se delegan a `new Date()`, porque solo estas
 * dicen por sí mismas qué instante son.
 */
const CON_HUSO = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Cuánto hay que sumarle a un reloj de pared de `ZONA_HORARIA` para
 * obtener UTC, en milisegundos, para el instante dado. Se calcula con
 * `Intl` en vez de hardcodear -06:00 para no mentir si la zona cambia de
 * reglas (México quitó el horario de verano en 2022, pero el dato
 * histórico sigue importando: un CSV puede traer ventas de 2021).
 */
function desplazamiento(instante: Date): number {
  // Al segundo: `formatToParts` no da milisegundos, así que compararlo
  // contra un instante que los trae metía los milisegundos en el
  // desplazamiento (un "fin del día" de 23:59:59.999 daba 06:00:00.998Z
  // en vez de 06:00:00.000Z, y el día siguiente dejaba de ser futuro).
  const alSegundo = Math.floor(instante.getTime() / 1000) * 1000;
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONA_HORARIA,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(alSegundo));
  const v = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value);
  const comoSiFueraUtc = relojDeParedUtc(
    v('year'),
    v('month'),
    v('day'),
    v('hour') % 24,
    v('minute'),
    v('second'),
  );
  return alSegundo - comoSiFueraUtc;
}

/**
 * Instante UTC de un reloj de pared de `ZONA_HORARIA`.
 *
 * Dos pasadas: el desplazamiento depende del instante, y el instante del
 * desplazamiento. La primera aproxima, la segunda corrige si el candidato
 * cayó del otro lado de un cambio de reglas.
 */
function instanteDe(
  anio: number,
  mes: number,
  dia: number,
  hora = 0,
  minuto = 0,
  segundo = 0,
  milis = 0,
): Date {
  const relojDePared = relojDeParedUtc(anio, mes, dia, hora, minuto, segundo, milis);
  const aproximado = new Date(relojDePared + desplazamiento(new Date(relojDePared)));
  return new Date(relojDePared + desplazamiento(aproximado));
}

/**
 * `Date.UTC` mapea los años 0-99 a 1900-1999, así que `0050-06-15` se
 * convertiría en 1950. `setUTCFullYear` fija el año literal.
 */
function relojDeParedUtc(
  anio: number,
  mes: number,
  dia: number,
  hora = 0,
  minuto = 0,
  segundo = 0,
  milis = 0,
): number {
  const fecha = new Date(Date.UTC(2000, mes - 1, dia, hora, minuto, segundo, milis));
  fecha.setUTCFullYear(anio);
  return fecha.getTime();
}

/** El día de `ahora` visto en `ZONA_HORARIA`. */
function diaLocal(ahora: Date): { anio: number; mes: number; dia: number } {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_HORARIA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(ahora);
  const v = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value);
  return { anio: v('year'), mes: v('month'), dia: v('day') };
}

/** Último milisegundo del día de `ahora`, en hora local. */
function finDelDia(ahora: Date): number {
  const { anio, mes, dia } = diaLocal(ahora);
  return instanteDe(anio, mes, dia, 23, 59, 59, 999).getTime();
}

/**
 * Hueco del cambio a horario de verano (una hora que no existió): el
 * doble paso converge al desplazamiento ANTERIOR, así que
 * `2021-04-04 02:30` en Monterrey queda como 01:30 CST, mientras que
 * Postgres (`AT TIME ZONE`) la movería a 03:30 CDT. El día nunca cambia y
 * México no tiene horario de verano desde 2022, así que se deja
 * documentado en vez de añadir la detección del hueco.
 */

/**
 * Una venta no puede estar fechada después de hoy. Se tolera el día
 * completo en curso —hasta las 23:59:59.999 LOCALES— para no rechazar una
 * captura de la tarde: en Monterrey, el día UTC termina a las 17:59 de la
 * tarde, así que medirlo en UTC rechazaba como "futura" una venta de las
 * 19:00 del mismo día.
 */
export function esFechaFutura(fecha: Date, ahora: Date = new Date()): boolean {
  return fecha.getTime() > finDelDia(ahora);
}

/**
 * `null` si el texto no es una fecha interpretable.
 *
 * Una fecha SIN huso se interpreta como reloj de pared de
 * `ZONA_HORARIA`, no como UTC. `new Date('2026-09-01')` devuelve la
 * medianoche UTC, que en Monterrey es el 31 de agosto a las 18:00: un CSV
 * con la columna de fecha sin hora —lo normal— guardaba cada venta un día
 * antes del que dice el archivo. Con huso explícito (`Z`, `-06:00`) se
 * respeta lo que trae el texto: ahí el emisor ya dijo qué instante es.
 */
export function parsearFecha(texto: string): Date | null {
  const limpio = texto.trim();
  // `new Date('2026-09')` devuelve el día 1 en UTC; una venta sin día no
  // es una fecha de venta y el mensaje del CSV ya pide `yyyy-mm-dd`.
  if (SIN_DIA.test(limpio)) return null;
  const partes = SIN_HUSO.exec(limpio);
  if (partes) {
    const [, anio, mes, dia, hora, minuto, segundo, milis] = partes;
    const n = {
      anio: Number(anio),
      mes: Number(mes),
      dia: Number(dia),
      hora: Number(hora ?? 0),
      minuto: Number(minuto ?? 0),
      segundo: Number(segundo ?? 0),
      // La fracción puede traer más de 3 dígitos; el resto se trunca,
      // que es lo que hace `new Date` con un ISO completo.
      milis: Number((milis ?? '0').padEnd(3, '0').slice(0, 3)),
    };
    // `Date.UTC` desborda en silencio: el día 45 del mes 13 se convierte
    // en una fecha del año siguiente. Un texto así no es una fecha y debe
    // devolver null, como lo hacía `new Date('2026-13-45')`.
    const valida =
      n.mes >= 1 &&
      n.mes <= 12 &&
      n.dia >= 1 &&
      n.dia <= diasDelMes(n.anio, n.mes) &&
      n.hora <= 23 &&
      n.minuto <= 59 &&
      n.segundo <= 59;
    if (!valida) return null;
    const fecha = instanteDe(n.anio, n.mes, n.dia, n.hora, n.minuto, n.segundo, n.milis);
    return Number.isNaN(fecha.getTime()) ? null : fecha;
  }
  // Con huso explícito el texto ya es un instante: se respeta tal cual.
  if (CON_HUSO.test(limpio)) {
    const fecha = new Date(limpio);
    return Number.isNaN(fecha.getTime()) ? null : fecha;
  }
  // Todo lo demás se rechaza en vez de delegarlo a `new Date()`. Ese
  // camino interpretaba en la zona del PROCESO, así que `2026-9-1`,
  // `09/01/2026` o `2026` se guardaban como medianoche UTC —el día
  // anterior en Monterrey— y encima el mismo CSV importaba distinto en
  // una Mac que en el contenedor. El mensaje del CSV y del alta manual
  // ya piden ISO (`yyyy-mm-dd`).
  return null;
}

/** Días del mes, contando los años bisiestos (incluido el año 0). */
function diasDelMes(anio: number, mes: number): number {
  return new Date(relojDeParedUtc(anio, mes + 1, 0)).getUTCDate();
}

/**
 * Número decimal estricto para celdas de CSV: `Number()` admite
 * notaciones que un archivo de ventas no debería traer (`1e3` → 1000,
 * `0x10` → 16, `Infinity`). Devuelve `null` si no es un decimal plano o si
 * excede los 2 decimales que admiten las columnas NUMERIC(_,2).
 */
export function parsearDecimal(texto: string | null): number | null {
  if (texto == null) return null;
  const limpio = texto.trim();
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(limpio)) return null;
  const valor = Number(limpio);
  return Number.isFinite(valor) ? valor : null;
}
