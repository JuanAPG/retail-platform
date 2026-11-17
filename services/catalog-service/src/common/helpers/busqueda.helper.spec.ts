import { patronDeBusqueda } from './busqueda.helper';

describe('patronDeBusqueda (T-21)', () => {
  it('busca en cualquier parte del texto', () => {
    expect(patronDeBusqueda('arroz')).toBe('%arroz%');
  });

  it('quita los espacios de los extremos y conserva los de en medio', () => {
    expect(patronDeBusqueda('  leche entera ')).toBe('%leche entera%');
  });

  it('sin texto, vacío o solo espacios: no hay nada que buscar', () => {
    expect(patronDeBusqueda(undefined)).toBeNull();
    expect(patronDeBusqueda('')).toBeNull();
    expect(patronDeBusqueda('   ')).toBeNull();
  });

  it('escapa los comodines de LIKE para buscarlos tal cual', () => {
    expect(patronDeBusqueda('100%')).toBe('%100\\%%');
    expect(patronDeBusqueda('a_b')).toBe('%a\\_b%');
    expect(patronDeBusqueda('c:\\x')).toBe('%c:\\\\x%');
  });
});
