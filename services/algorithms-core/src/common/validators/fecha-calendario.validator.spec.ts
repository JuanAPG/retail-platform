import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AnalyticsFilterDto } from '../../association/dto/analytics-filter.dto';
import { ElasticityParamsDto } from '../../elasticity/dto/elasticity-params.dto';
import { esFechaCalendario } from './fecha-calendario.validator';

/** Mensajes de error del DTO, como los vería el cliente en el 400. */
async function errores(dto: new () => object, cuerpo: object): Promise<string[]> {
  const fallas = await validate(plainToInstance(dto, cuerpo));
  return fallas.flatMap((f) => Object.values(f.constraints ?? {}));
}

// Las cinco del hallazgo QA-ALG56-02 (respondían 500) y otras formas que no son 'aaaa-mm-dd'.
const INVALIDAS = ['2026', '2026-09', '2026-02-30', '2026-09-31', '2026-W40-1', '20260910', '2026-9-1', '2026-09-01T10:00:00Z', '', 'mañana'];

describe('fecha de calendario aaaa-mm-dd (QA-ALG56-02)', () => {
  it('acepta solo fechas que existen, incluido el 29 de febrero de un año bisiesto', () => {
    expect(['2026-09-01', '2024-02-29', '2026-12-31'].every(esFechaCalendario)).toBe(true);
    expect(esFechaCalendario('2026-02-29')).toBe(false);
    expect(INVALIDAS.filter(esFechaCalendario)).toEqual([]);
  });

  // Los dos DTOs con fechas: calculate de elasticidad y Apriori.
  describe.each([
    ['ElasticityParamsDto', ElasticityParamsDto, {}],
    ['AnalyticsFilterDto (Apriori)', AnalyticsFilterDto, {}],
  ])('%s', (_, dto, base) => {
    it.each(INVALIDAS)('rechaza %p con un solo mensaje claro', async (fecha) => {
      expect(await errores(dto, { ...base, dateFrom: fecha })).toEqual(['dateFrom debe ser una fecha real con formato aaaa-mm-dd.']);
      expect(await errores(dto, { ...base, dateTo: fecha })).toEqual(['dateTo debe ser una fecha real con formato aaaa-mm-dd.']);
    });

    it('acepta dateFrom y dateTo válidos', async () => {
      expect(await errores(dto, { ...base, dateFrom: '2026-08-02', dateTo: '2026-09-20' })).toEqual([]);
    });
  });
});
