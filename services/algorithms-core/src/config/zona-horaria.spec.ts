import databaseConfig from './database.config';
import { fechaLocal, ZONA_HORARIA } from './zona-horaria';

describe('zona horaria del negocio', () => {
  it('por defecto es America/Monterrey', () => {
    expect(ZONA_HORARIA).toBe('America/Monterrey');
  });

  it('fechaLocal corta el día a medianoche de Monterrey, no de UTC', () => {
    // 01:30 UTC del 9 = 19:30 del 8 en Monterrey; 06:00 UTC = medianoche local.
    expect(fechaLocal(new Date('2026-10-09T01:30:00Z'))).toBe('2026-10-08');
    expect(fechaLocal(new Date('2026-10-09T05:59:59Z'))).toBe('2026-10-08');
    expect(fechaLocal(new Date('2026-10-09T06:00:00Z'))).toBe('2026-10-09');
  });

  it('la sesión de Postgres arranca en la misma zona', () => {
    const opciones = databaseConfig() as { extra?: { options?: string } };
    expect(opciones.extra?.options).toBe('-c timezone=America/Monterrey');
  });
});
