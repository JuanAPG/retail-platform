import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegistrarEventoDto } from './registrar-evento.dto';

const UUID_V4 = '123e4567-e89b-42d3-a456-426614174000';

describe('RegistrarEventoDto', () => {
  it('acepta un evento completo', async () => {
    const dto = plainToInstance(RegistrarEventoDto, {
      tabla: 'usuarios',
      registroId: 'u1',
      accion: 'update',
      descripcion: 'Usuario actualizado.',
      cambios: [{ campo: 'activo', previo: 'true', posterior: 'false' }],
      usuarioId: UUID_V4,
      rolId: 1,
      ip: '172.18.0.5',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rechaza sin tabla y con acción fuera del catálogo', async () => {
    const dto = Object.assign(new RegistrarEventoDto(), { accion: 'borrar_todo' });
    const errores = await validate(dto);
    expect(errores.length).toBeGreaterThan(0);
  });

  it('acepta evento mínimo (solo tabla y acción)', async () => {
    const dto = plainToInstance(RegistrarEventoDto, { tabla: 'precios', accion: 'login' });
    expect(await validate(dto)).toHaveLength(0);
  });
});
