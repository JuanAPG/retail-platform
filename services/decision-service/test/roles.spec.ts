/**
 * Matriz de roles de decision-service contra el servicio real (D-12 y la
 * matriz de permisos, M13/M14). No crea datos: el guard de roles corre
 * antes de validar, así que con un cuerpo inválido 403 = rol bloqueado y
 * 400 = rol permitido; con un UUID inexistente, 404 = rol permitido.
 *
 *   docker compose -f infra/docker-compose.yml up -d postgres redis auth-service decision-service
 *   npm run test:integracion
 */
import { randomUUID } from 'crypto';
import { CUENTAS, entrar, http } from './apoyo';

type Rol = keyof typeof CUENTAS;
const ROLES = Object.keys(CUENTAS) as Rol[];

describe('Matriz de roles (integración)', () => {
  const tokens = {} as Record<Rol, string>;

  beforeAll(async () => {
    for (const rol of ROLES) tokens[rol] = await entrar(CUENTAS[rol]);
  });

  describe.each([
    ['/v1/simulation/price', {}],
    ['/v1/simulation/presentation', {}],
    // `{}` es un cuerpo VÁLIDO para generate (zoneId es opcional): con él el
    // Planeador generaría de verdad y reemplazaría todas las 'propuesta'.
    // Se manda un zoneId inválido para quedarse en el 400.
    ['/v1/recommendations/generate', { zoneId: 'no-es-uuid' }],
  ])('POST %s', (ruta, cuerpo) => {
    it.each(ROLES)('%s', async (rol) => {
      const r = await http('POST', ruta, tokens[rol], { cuerpo });
      expect(r.estado).toBe(rol === 'Planeador' ? 400 : 403);
    });
  });

  describe.each([
    ['approve', undefined],
    // Con motivo válido: sin él, el Gerente recibiría 400 antes de llegar al 404.
    ['reject', { motivo: 'Motivo de prueba de la matriz de roles.' }],
  ])('PATCH /v1/recommendations/:id/%s con un UUID inexistente', (accion, cuerpo) => {
    it.each(ROLES)('%s', async (rol) => {
      const r = await http('PATCH', `/v1/recommendations/${randomUUID()}/${accion}`, tokens[rol], { cuerpo });
      expect(r.estado).toBe(rol === 'Gerente' ? 404 : 403);
    });
  });
});
