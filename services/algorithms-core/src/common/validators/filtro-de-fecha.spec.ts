import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AnalyticsFilterDto } from '../../association/dto/analytics-filter.dto';
import { ElasticityParamsDto } from '../../elasticity/dto/elasticity-params.dto';
import { diaDelFiltro, esFiltroDeFecha } from './filtro-de-fecha';

/** Mensajes de error del DTO, como los vería el cliente en el 400. */
async function errores(dto: new () => object, cuerpo: object): Promise<string[]> {
  const fallas = await validate(plainToInstance(dto, cuerpo));
  return fallas.flatMap((f) => Object.values(f.constraints ?? {}));
}

// Las de QA-ALG56-02 (respondían 500 o un 400 con mensaje falso) y otras formas que no son un día.
const INVALIDAS = ['2026', '2026-09', '2026-02-30', '2026-09-31', '2026-W40-1', '2026-273', '20260910', '2026-9-1', '', 'mañana'];
// Un día, o un ISO completo del que solo se usa el día (igual que core-process).
const VALIDAS = ['2026-09-01', '2024-02-29', '2026-09-01T23:30:00-06:00', '2026-09-01 10:00'];

describe('filtro de fecha: mismo criterio que EsFiltroDeFecha de core-process (QA-ALG56-02)', () => {
  it('acepta un día que existe, con o sin hora, y rechaza lo demás', () => {
    expect(VALIDAS.every(esFiltroDeFecha)).toBe(true);
    expect(esFiltroDeFecha('2026-02-29')).toBe(false);
    expect(INVALIDAS.filter(esFiltroDeFecha)).toEqual([]);
  });

  it('de una fecha con hora solo se usa el día, tal como viene escrito', () => {
    expect(diaDelFiltro('2026-09-01T23:30:00-06:00')).toBe('2026-09-01');
    expect(diaDelFiltro('2026-09-01')).toBe('2026-09-01');
    expect(diaDelFiltro(undefined)).toBeUndefined();
  });

  // Los dos DTOs con fechas: calculate de elasticidad y Apriori.
  describe.each([
    ['ElasticityParamsDto', ElasticityParamsDto],
    ['AnalyticsFilterDto (Apriori)', AnalyticsFilterDto],
  ])('%s', (_, dto) => {
    it.each(INVALIDAS)('rechaza %p con un solo mensaje claro', async (fecha) => {
      expect(await errores(dto, { dateFrom: fecha })).toEqual([
        'dateFrom debe ser una fecha YYYY-MM-DD existente (el filtro es por día completo).',
      ]);
      expect(await errores(dto, { dateTo: fecha })).toEqual([
        'dateTo debe ser una fecha YYYY-MM-DD existente (el filtro es por día completo).',
      ]);
    });

    it.each(VALIDAS)('acepta %p', async (fecha) => {
      expect(await errores(dto, { dateFrom: fecha, dateTo: fecha })).toEqual([]);
    });
  });
});
