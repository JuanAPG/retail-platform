import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegistrarEventoDto } from './registrar-evento.dto';

describe('RegistrarEventoDto', () => {
  it('acepta un evento completo', async () => {
    const dto = plainToInstance(RegistrarEventoDto, {
      tabla: 'usuarios',
      registroId: 'u1',
      servicio: 'pricing-service',
      accion: 'update',
      descripcion: 'Usuario actualizado.',
      cambios: [{ campo: 'activo', previo: 'true', posterior: 'false' }],
      ip: '172.18.0.5',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rechaza sin tabla y con acción fuera del catálogo', async () => {
    const dto = Object.assign(new RegistrarEventoDto(), { accion: 'borrar_todo' });
    const errores = await validate(dto);
    expect(errores.length).toBeGreaterThan(0);
  });

  it('acepta evento mínimo (solo tabla, servicio y acción)', async () => {
    const dto = plainToInstance(RegistrarEventoDto, {
      tabla: 'precios',
      servicio: 'pricing-service',
      accion: 'login',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rechaza sin servicio', async () => {
    const dto = plainToInstance(RegistrarEventoDto, { tabla: 'precios', accion: 'login' });
    const errores = await validate(dto);
    expect(errores.some((e) => e.property === 'servicio')).toBe(true);
  });

  it('acepta las acciones de negocio nuevas', async () => {
    for (const accion of [
      'aprobar',
      'rechazar',
      'desactivar',
      'ejecutar_corrida',
      'simular',
      'generar_recomendacion',
      'exportar',
    ]) {
      const dto = plainToInstance(RegistrarEventoDto, {
        tabla: 'precios_propuestos_proveedor',
        servicio: 'pricing-service',
        accion,
      });
      expect(await validate(dto)).toHaveLength(0);
    }
  });

  it('rechaza usuarioId o rolId en el cuerpo (el actor sale siempre del token)', async () => {
    // Mismas opciones que el ValidationPipe global (main.ts): sin ellas,
    // una propiedad fuera del DTO simplemente se ignora en vez de rechazarse.
    const dto = plainToInstance(RegistrarEventoDto, {
      tabla: 'usuarios',
      servicio: 'pricing-service',
      accion: 'update',
      usuarioId: '123e4567-e89b-42d3-a456-426614174000',
      rolId: 1,
    });
    const errores = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errores.some((e) => e.property === 'usuarioId')).toBe(true);
    expect(errores.some((e) => e.property === 'rolId')).toBe(true);
  });
});
