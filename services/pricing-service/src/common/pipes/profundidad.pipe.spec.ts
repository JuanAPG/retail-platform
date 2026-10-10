import { BadRequestException } from '@nestjs/common';
import { profundidad, ProfundidadPipe, PROFUNDIDAD_MAXIMA } from './profundidad.pipe';

const anidado = (niveles: number) => {
  let v: unknown = 1;
  for (let i = 0; i < niveles; i++) v = [v];
  return v;
};

describe('profundidad', () => {
  it.each([
    [1, 0],
    ['x', 0],
    [null, 0],
    [{}, 1],
    [[], 1],
    [{ a: 1 }, 1],
    [{ a: { b: 1 } }, 2],
    [{ a: [{ b: 1 }] }, 3],
    [{ a: 1, b: { c: { d: 1 } } }, 3],
  ])('%j tiene profundidad %i', (valor, esperado) => expect(profundidad(valor)).toBe(esperado));

  it('un arreglo de 100 000 niveles no revienta la pila (sin recursión) y se corta temprano', () => {
    expect(profundidad(anidado(100_000))).toBeGreaterThan(PROFUNDIDAD_MAXIMA);
  });
});

describe('ProfundidadPipe', () => {
  const pipe = new ProfundidadPipe();

  it('deja pasar un cuerpo normal y no toca otros tipos de parámetro', () => {
    const cuerpo = { storeIds: ['a', 'b'], detalle: { x: { y: 1 } } };
    expect(pipe.transform(cuerpo, { type: 'body' })).toBe(cuerpo);
    expect(pipe.transform(anidado(500), { type: 'query' })).toBeDefined();
  });

  it('el cuerpo con exactamente el máximo pasa; con uno más, 400', () => {
    expect(() => pipe.transform(anidado(PROFUNDIDAD_MAXIMA), { type: 'body' })).not.toThrow();
    expect(() => pipe.transform(anidado(PROFUNDIDAD_MAXIMA + 1), { type: 'body' })).toThrow(BadRequestException);
  });

  it('un cuerpo de 5 000 niveles responde 400, no un stack overflow', () => {
    expect(() => pipe.transform(anidado(5000), { type: 'body' })).toThrow(/anidado/);
  });
});
