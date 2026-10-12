import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuditFilterDto } from './audit-filter.dto';

/** Mismas opciones que el ValidationPipe global de main.ts. */
const OPCIONES = { whitelist: true, forbidNonWhitelisted: true };

async function errores(query: Record<string, unknown>) {
  return validate(plainToInstance(AuditFilterDto, query), OPCIONES);
}

describe('AuditFilterDto', () => {
  it('sin filtros es válido (bitácora completa paginada)', async () => {
    expect(await errores({})).toHaveLength(0);
  });

  it('acepta el historial por entidad del contrato (tabla + registroId)', async () => {
    expect(await errores({ tabla: 'precios', registroId: '42' })).toHaveLength(0);
  });

  it('acepta un rango de días completos', async () => {
    expect(await errores({ dateFrom: '2026-09-01', dateTo: '2026-09-30' })).toHaveLength(0);
  });

  /**
   * El contrato dice que `dateFrom`/`dateTo` son días completos. Con
   * `@IsDateString()` entraba también `2026-10-10T15:00:00Z`, y cada
   * extremo la interpretaba distinto: `dateFrom` respetaba la hora y
   * `dateTo` la tiraba al hacer CAST a date. Ahora el formato con hora se
   * rechaza con 400 en vez de contestar un rango que el cliente no pidió.
   */
  it('rechaza una fecha con hora, en los dos extremos', async () => {
    for (const campo of ['dateFrom', 'dateTo']) {
      for (const valor of ['2026-10-10T15:00:00Z', '2026-10-10T00:00:00', '2026-10-10 15:00']) {
        const encontrados = await errores({ [campo]: valor });
        expect(encontrados.some((e) => e.property === campo)).toBe(true);
      }
    }
  });

  it('rechaza una fecha que no es fecha', async () => {
    expect((await errores({ dateFrom: 'ayer' })).some((e) => e.property === 'dateFrom')).toBe(true);
  });

  it('acota servicio a los 10 microservicios, igual que el POST', async () => {
    expect(await errores({ servicio: 'pricing-service' })).toHaveLength(0);
    expect(
      (await errores({ servicio: 'servicio-que-no-existe' })).some((e) => e.property === 'servicio'),
    ).toBe(true);
  });

  it('rechaza accion fuera del catálogo y usuarioId que no es UUID', async () => {
    expect((await errores({ accion: 'borrar_todo' })).some((e) => e.property === 'accion')).toBe(true);
    expect((await errores({ usuarioId: 'u1' })).some((e) => e.property === 'usuarioId')).toBe(true);
  });

  it('rechaza filtros de texto desmedidos', async () => {
    expect((await errores({ tabla: 't'.repeat(81) })).some((e) => e.property === 'tabla')).toBe(true);
    expect(
      (await errores({ registroId: 'r'.repeat(201) })).some((e) => e.property === 'registroId'),
    ).toBe(true);
  });

  it('rechaza un filtro que no existe (no se ignora en silencio)', async () => {
    expect((await errores({ entityType: 'precios' })).length).toBeGreaterThan(0);
  });
});
