import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ElasticityParamsDto, GRANULARITIES } from './elasticity-params.dto';

/** Mensajes de error, como llegan del cuerpo JSON (texto u omitido). */
async function errores(body: Record<string, unknown>): Promise<string[]> {
  const fallas = await validate(plainToInstance(ElasticityParamsDto, body));
  return fallas.flatMap((f) => Object.values(f.constraints ?? {}));
}

describe('ElasticityParamsDto: granularidad (D-21)', () => {
  it('existen día, semana y mes', () => {
    expect(GRANULARITIES).toEqual(['day', 'week', 'month']);
  });

  it('sin granularity, el default es semana', () => {
    const dto = plainToInstance(ElasticityParamsDto, {});
    expect(dto.granularity).toBe('week');
  });

  it.each(GRANULARITIES)('acepta granularity=%s', async (granularity) => {
    expect(await errores({ granularity })).toEqual([]);
  });

  it('rechaza una granularidad que no es día, semana ni mes', async () => {
    expect(await errores({ granularity: 'year' })).toEqual(["granularity debe ser 'day', 'week' o 'month'."]);
  });
});
