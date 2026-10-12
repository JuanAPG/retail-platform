import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AprioriParamsDto } from './apriori-params.dto';

/** Mensajes de error del DTO, como los vería el cliente en el 400. */
async function errores(cuerpo: object): Promise<string[]> {
  const fallas = await validate(plainToInstance(AprioriParamsDto, cuerpo));
  return fallas.flatMap((f) => Object.values(f.constraints ?? {}));
}

describe('AprioriParamsDto: umbrales de D-17 (mayores a 0 y hasta 1)', () => {
  it.each([0.0001, 0.005, 0.01, 0.5, 1])('acepta soporte y confianza de %p', async (valor) => {
    expect(await errores({ minSupport: valor, minConfidence: valor })).toEqual([]);
  });

  it.each([
    [{ minSupport: 0, minConfidence: 0.5 }, 'minSupport debe ser mayor a 0.'],
    [{ minSupport: -0.1, minConfidence: 0.5 }, 'minSupport debe ser mayor a 0.'],
    [{ minSupport: 1.01, minConfidence: 0.5 }, 'minSupport no puede ser mayor a 1.'],
    [{ minSupport: 0.5, minConfidence: 0 }, 'minConfidence debe ser mayor a 0.'],
    [{ minSupport: 0.5, minConfidence: 1.01 }, 'minConfidence no puede ser mayor a 1.'],
  ])('rechaza %j', async (cuerpo, mensaje) => {
    expect(await errores(cuerpo)).toEqual([mensaje]);
  });
});
