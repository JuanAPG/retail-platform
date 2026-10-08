/**
 * Datos de ejemplo para la documentación Swagger. Reflejan la forma real de
 * cada respuesta (ver docs/contratos/audit-service.md); los valores son
 * ilustrativos. `usuarioId`/`rolId` son siempre el actor del token, nunca
 * algo que el cliente escriba.
 */

const FECHA = '2026-10-03T12:00:00.000Z';

export const evento = {
  id: '123',
  usuarioId: '7f8d6b2a-7f3a-4b8a-9b0a-3b8f9a2c1d4e',
  rolId: 1,
  tablaAfectada: 'usuarios',
  registroId: 'a@x.mx',
  servicio: 'auth-service',
  accion: 'update',
  descripcion: 'Usuario actualizado (a@x.mx).',
  direccionIp: '172.18.0.5',
  fecha: FECHA,
  cambios: [{ auditoriaId: '123', campo: 'activo', valorPrevio: 'true', valorPosterior: 'false' }],
};

export const eventoSinCambios = {
  id: '124',
  usuarioId: '9c6a1d2e-4b3f-4a1c-8e2d-7f6a5b4c3d2e',
  rolId: 1,
  tablaAfectada: 'usuarios',
  registroId: null,
  servicio: 'auth-service',
  accion: 'login',
  descripcion: null,
  direccionIp: '172.18.0.5',
  fecha: FECHA,
  cambios: [],
};

export const pagina = {
  data: [evento, eventoSinCambios],
  total: 2,
  page: 1,
  limit: 20,
};
