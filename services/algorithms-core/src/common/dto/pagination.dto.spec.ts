import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PAGINA_MAXIMA, PaginationDto } from './pagination.dto';

/** Mensajes de error, como llegan del query string (texto). */
async function errores(query: Record<string, string>): Promise<string[]> {
  const fallas = await validate(plainToInstance(PaginationDto, query));
  return fallas.flatMap((f) => Object.values(f.constraints ?? {}));
}

describe('PaginationDto: page entre 1 y 1 000 000 (paginacion.md, QA-ALG56-14)', () => {
  it.each(['1', '2', String(PAGINA_MAXIMA)])('acepta page=%s', async (page) => {
    expect(await errores({ page })).toEqual([]);
  });

  it.each([String(PAGINA_MAXIMA + 1), '1000000000000'])('rechaza page=%s con 400', async (page) => {
    expect(await errores({ page })).toEqual(['page no puede pasar de 1000000.']);
  });

  it('page 0 sigue siendo inválida', async () => {
    expect(await errores({ page: '0' })).toEqual(['page debe ser mayor a 0.']);
  });
});
