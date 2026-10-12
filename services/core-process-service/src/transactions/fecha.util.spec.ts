import { esFechaFutura, parsearDecimal, parsearFecha } from './fecha.util';
import { diaLocal, ZONA_HORARIA } from '../common/zona-horaria';

/** Lo que se ve en Monterrey para un instante dado. */
function enMonterrey(fecha: Date): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Monterrey',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(fecha);
}

describe('parsearFecha', () => {
  it('el huso del negocio es America/Monterrey', () => {
    expect(ZONA_HORARIA).toBe('America/Monterrey');
  });

  /**
   * El defecto: un CSV de ventas trae la columna de fecha sin hora, que es
   * lo normal. `new Date('2026-09-01')` devuelve la medianoche UTC, o sea
   * el 31 de agosto a las 18:00 en Monterrey, así que la venta quedaba
   * fechada un día antes del que dice el archivo.
   */
  it('una fecha SIN hora es medianoche local, no medianoche UTC', () => {
    const fecha = parsearFecha('2026-09-01')!;
    expect(fecha.toISOString()).toBe('2026-09-01T06:00:00.000Z');
    expect(enMonterrey(fecha)).toBe('2026-09-01 00:00');
  });

  it('una fecha con hora pero sin huso es reloj de pared local', () => {
    // 21:00 del día 1 en Monterrey ya es el día 2 en UTC: justo el caso
    // que se perdía al revés.
    expect(parsearFecha('2026-09-01 21:00')!.toISOString()).toBe('2026-09-02T03:00:00.000Z');
    expect(parsearFecha('2026-09-01T21:00')!.toISOString()).toBe('2026-09-02T03:00:00.000Z');
    expect(parsearFecha('2026-09-01T21:00:30')!.toISOString()).toBe('2026-09-02T03:00:30.000Z');
    expect(parsearFecha('2026-09-01T21:00:30.500')!.toISOString()).toBe('2026-09-02T03:00:30.500Z');
  });

  it('con huso explícito se respeta el instante que manda el emisor', () => {
    expect(parsearFecha('2026-09-01T21:00:00Z')!.toISOString()).toBe('2026-09-01T21:00:00.000Z');
    expect(parsearFecha('2026-09-01T21:00:00-06:00')!.toISOString()).toBe('2026-09-02T03:00:00.000Z');
    expect(parsearFecha('2026-09-01T21:00:00+02:00')!.toISOString()).toBe('2026-09-01T19:00:00.000Z');
  });

  /**
   * `datos_prueba_100_canastas.csv` trae sus 154 filas con el huso en
   * SOLO HORAS (`-06`, sin minutos): `2026-08-02 10:15:00-06`. Es ISO
   * 8601 válido y `new Date()` lo entiende bien, pero el regex pedía
   * minutos obligatorios y las 154 filas daban FECHA_INVALIDA.
   */
  it('con huso en solo horas (sin minutos), como el CSV de 100 canastas', () => {
    expect(parsearFecha('2026-08-02 10:15:00-06')!.toISOString()).toBe('2026-08-02T16:15:00.000Z');
    expect(parsearFecha('2026-08-02 10:15:00+06')!.toISOString()).toBe('2026-08-02T04:15:00.000Z');
    // -0600 (sin colon) y -06:00 deben seguir dando el mismo instante.
    expect(parsearFecha('2026-08-02 10:15:00-0600')!.toISOString()).toBe('2026-08-02T16:15:00.000Z');
    expect(parsearFecha('2026-08-02 10:15:00-06:00')!.toISOString()).toBe('2026-08-02T16:15:00.000Z');
  });

  it('usa las reglas de la zona VIGENTES en esa fecha, no un -06:00 fijo', () => {
    // México tuvo horario de verano hasta 2022: en junio de 2021 Monterrey
    // era UTC-5, así que la medianoche local fue 05:00Z, no 06:00Z.
    expect(parsearFecha('2021-06-15')!.toISOString()).toBe('2021-06-15T05:00:00.000Z');
    // Ya sin horario de verano.
    expect(parsearFecha('2026-06-15')!.toISOString()).toBe('2026-06-15T06:00:00.000Z');
  });

  it('el día local se conserva en todo el año (no se corre en ningún mes)', () => {
    for (let mes = 1; mes <= 12; mes++) {
      const texto = `2026-${String(mes).padStart(2, '0')}-01`;
      expect(enMonterrey(parsearFecha(texto)!)).toBe(`${texto} 00:00`);
    }
  });

  /**
   * El camino laxo (`new Date(texto)`) interpretaba en la zona del
   * PROCESO: `2026-9-1` se guardaba como medianoche UTC —el 31 de agosto
   * en Monterrey— y el mismo CSV importaba distinto en una Mac que en el
   * contenedor. Ahora solo se delega a `new Date()` lo que trae huso
   * explícito; el resto se rechaza.
   */
  it('rechaza formatos que antes se colaban interpretados en la zona del proceso', () => {
    for (const texto of [
      '2026-9-1',
      '09/01/2026',
      '2026/09/01',
      '12/31/2099',
      '2026',
      'Sep 1 2026',
      '2026-09-01T10:00:00+0600extra',
    ]) {
      expect(parsearFecha(texto)).toBeNull();
    }
  });

  it('una fracción de segundo larga no cambia de regla a mitad de camino', () => {
    // Antes, con 4 decimales se caía al camino laxo (UTC) y con 3 no.
    expect(parsearFecha('2026-09-18 00:00:00.1234')!.toISOString()).toBe('2026-09-18T06:00:00.123Z');
    expect(parsearFecha('2026-09-18 00:00:00.5')!.toISOString()).toBe('2026-09-18T06:00:00.500Z');
  });

  it('un año de uno o dos dígitos no se convierte en 1900 y algo', () => {
    // `Date.UTC` mapea 0-99 a 1900-1999.
    expect(parsearFecha('0050-06-15')!.getUTCFullYear()).toBe(50);
    expect(parsearFecha('0004-02-29')!.getUTCFullYear()).toBe(4);
    // El año 0 es bisiesto: el 29 de febrero existe.
    expect(parsearFecha('0000-02-29')).not.toBeNull();
  });

  it('sigue devolviendo null si no es una fecha', () => {
    for (const basura of ['no-soy-fecha', '', 'ayer', '2026-09']) {
      expect(parsearFecha(basura)).toBeNull();
    }
  });

  /**
   * `Date.UTC` desborda en silencio (mes 13, día 45 → año siguiente), así
   * que un texto con forma de fecha pero imposible tiene que seguir dando
   * null como antes, no una fecha inventada.
   */
  it('una fecha imposible no se desborda al año siguiente', () => {
    for (const imposible of ['2026-13-45', '2026-00-10', '2026-02-30', '2026-09-32', '2026-09-01T25:00', '2026-09-01T10:61']) {
      expect(parsearFecha(imposible)).toBeNull();
    }
    // 2024 sí es bisiesto, 2026 no.
    expect(parsearFecha('2024-02-29')).not.toBeNull();
    expect(parsearFecha('2026-02-29')).toBeNull();
  });

  it('tolera espacios alrededor (celdas de CSV)', () => {
    expect(parsearFecha('  2026-09-01  ')!.toISOString()).toBe('2026-09-01T06:00:00.000Z');
  });
});

describe('esFechaFutura con fechas locales', () => {
  it('una venta de hoy capturada sin hora no es futura', () => {
    const ahora = new Date('2026-09-01T18:00:00Z'); // 12:00 en Monterrey
    expect(esFechaFutura(parsearFecha('2026-09-01')!, ahora)).toBe(false);
  });

  /**
   * En Monterrey el día UTC termina a las 17:59 de la tarde: medir la
   * tolerancia en UTC rechazaba como "futura" una venta de la noche del
   * mismo día. Ahora el día en curso es el día local completo.
   */
  it('una venta de las 21:00 de hoy (03:00Z de mañana) tampoco', () => {
    const ahora = new Date('2026-09-02T01:00:00Z'); // 19:00 del 1 en Monterrey
    expect(esFechaFutura(parsearFecha('2026-09-01 21:00')!, ahora)).toBe(false);
    expect(esFechaFutura(parsearFecha('2026-09-01 23:59:59')!, ahora)).toBe(false);
  });

  it('mañana sí es futura', () => {
    const ahora = new Date('2026-09-01T18:00:00Z'); // 12:00 del 1 en Monterrey
    expect(esFechaFutura(parsearFecha('2026-09-02')!, ahora)).toBe(true);
    expect(esFechaFutura(parsearFecha('2026-09-02 00:00')!, ahora)).toBe(true);
  });
});

describe('parsearDecimal (regresión: no se tocó)', () => {
  it('acepta decimales planos y rechaza notaciones raras', () => {
    expect(parsearDecimal('10.50')).toBe(10.5);
    expect(parsearDecimal('1e3')).toBeNull();
    expect(parsearDecimal('0x10')).toBeNull();
    expect(parsearDecimal('10.555')).toBeNull();
    expect(parsearDecimal(null)).toBeNull();
  });
});

describe('diaLocal (etiqueta de día del preview del CSV)', () => {
  it('es el día local, no el día UTC', () => {
    // 21:00 del 30 de septiembre en Monterrey ya es el 1 de octubre en UTC.
    const venta = parsearFecha('2026-09-30 21:00')!;
    expect(venta.toISOString().slice(0, 10)).toBe('2026-10-01');
    expect(diaLocal(venta)).toBe('2026-09-30');
  });

  it('una fecha sin hora conserva su propio día', () => {
    expect(diaLocal(parsearFecha('2026-09-01')!)).toBe('2026-09-01');
  });
});
