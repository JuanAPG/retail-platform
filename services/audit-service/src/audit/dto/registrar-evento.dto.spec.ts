import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LARGO, RegistrarEventoDto } from './registrar-evento.dto';
import { SERVICIOS } from '../../common/servicios';

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
  // --- DEFECTO-A: lo que no cabe en la columna debe ser 400, no 500 ---
  describe('topes de longitud (si no, revienta en Postgres y el emisor ve un 500)', () => {
    const base = { servicio: 'pricing-service', accion: 'insert' as const };

    it('rechaza tabla de 81 caracteres (columna VARCHAR(80))', async () => {
      const dto = plainToInstance(RegistrarEventoDto, { ...base, tabla: 't'.repeat(81) });
      const errores = await validate(dto);
      expect(errores.some((e) => e.property === 'tabla')).toBe(true);
    });

    it('acepta tabla de exactamente 80 caracteres', async () => {
      const dto = plainToInstance(RegistrarEventoDto, { ...base, tabla: 't'.repeat(80) });
      expect(await validate(dto)).toHaveLength(0);
    });

    it('rechaza cambios[].campo de 81 caracteres (columna VARCHAR(80))', async () => {
      const dto = plainToInstance(RegistrarEventoDto, {
        ...base,
        tabla: 'precios',
        accion: 'update',
        cambios: [{ campo: 'c'.repeat(81), previo: '1', posterior: '2' }],
      });
      const errores = await validate(dto);
      expect(errores.some((e) => e.property === 'cambios')).toBe(true);
    });

    it('rechaza descripcion y registroId desmedidos (TEXT sin tope en la base)', async () => {
      const dto = plainToInstance(RegistrarEventoDto, {
        ...base,
        tabla: 'precios',
        descripcion: 'x'.repeat(LARGO.DESCRIPCION + 1),
        registroId: 'y'.repeat(LARGO.REGISTRO_ID + 1),
      });
      const errores = await validate(dto);
      expect(errores.some((e) => e.property === 'descripcion')).toBe(true);
      expect(errores.some((e) => e.property === 'registroId')).toBe(true);
    });

    it('rechaza valores de cambio desmedidos', async () => {
      const dto = plainToInstance(RegistrarEventoDto, {
        ...base,
        tabla: 'precios',
        accion: 'update',
        cambios: [{ campo: 'precio', previo: 'x'.repeat(LARGO.VALOR + 1), posterior: '2' }],
      });
      expect(await validate(dto)).not.toHaveLength(0);
    });

    it('rechaza una ip que no es IP (columna INET)', async () => {
      const dto = plainToInstance(RegistrarEventoDto, {
        ...base,
        tabla: 'precios',
        ip: 'no-soy-una-ip',
      });
      const errores = await validate(dto);
      expect(errores.some((e) => e.property === 'ip')).toBe(true);
    });

    it('acepta las IP que mandan los reporteros detrás de Docker', async () => {
      for (const ip of ['172.18.0.5', '::1', '::ffff:172.18.0.1', '2001:db8::1']) {
        const dto = plainToInstance(RegistrarEventoDto, { ...base, tabla: 'precios', ip });
        expect(await validate(dto)).toHaveLength(0);
      }
    });
  });

  // --- DEFECTO-B: PRIMARY KEY (auditoria_id, campo) ---
  describe('un evento no puede traer el mismo campo dos veces', () => {
    it('rechaza cambios con el campo repetido, nombrando el repetido', async () => {
      const dto = plainToInstance(RegistrarEventoDto, {
        tabla: 'precios',
        servicio: 'pricing-service',
        accion: 'update',
        cambios: [
          { campo: 'precio', previo: '10', posterior: '20' },
          { campo: 'precio', previo: '20', posterior: '30' },
        ],
      });
      const errores = await validate(dto);
      const error = errores.find((e) => e.property === 'cambios');
      expect(error).toBeDefined();
      expect(Object.values(error!.constraints ?? {}).join(' ')).toContain('precio');
    });

    it('acepta varios cambios de campos distintos en el mismo evento', async () => {
      const dto = plainToInstance(RegistrarEventoDto, {
        tabla: 'precios',
        servicio: 'pricing-service',
        accion: 'update',
        cambios: [
          { campo: 'precio', previo: '10', posterior: '20' },
          { campo: 'vigencia_desde', previo: null, posterior: '2026-10-13' },
        ],
      });
      expect(await validate(dto)).toHaveLength(0);
    });
  });

  // --- DEFECTO-C: servicio contra la lista cerrada de los 10 ---
  describe('servicio emisor acotado a los 10 microservicios', () => {
    it('acepta los 10 nombres reales', async () => {
      for (const servicio of SERVICIOS) {
        const dto = plainToInstance(RegistrarEventoDto, {
          tabla: 'precios',
          servicio,
          accion: 'insert',
        });
        expect(await validate(dto)).toHaveLength(0);
      }
    });

    it('rechaza un servicio inventado (antes cualquier sesión podía firmar como quisiera)', async () => {
      for (const servicio of ['servicio-que-no-existe', 'auth-servicio', 'AUTH-SERVICE', '']) {
        const dto = plainToInstance(RegistrarEventoDto, {
          tabla: 'precios',
          servicio,
          accion: 'insert',
        });
        const errores = await validate(dto);
        expect(errores.some((e) => e.property === 'servicio')).toBe(true);
      }
    });
  });
});
