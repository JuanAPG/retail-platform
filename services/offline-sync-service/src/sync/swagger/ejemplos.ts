import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { OpenAPIObject } from '@nestjs/swagger';
import { serializarXml } from '../../common/interceptors/xml.interceptor';

/**
 * Ejemplos de Swagger, tomados del contrato (§4.1, §4.5, §5). El XML se
 * genera con el MISMO serializador del `XmlInterceptor`, así el ejemplo es
 * exactamente lo que sale con `Accept: application/xml`. Una prueba
 * unitaria valida cada ejemplo XML contra el XSD.
 */

export const NAMESPACE = 'sync/v1';

export function ejemploXml(ejemplo: unknown, raiz: string): string {
  return serializarXml(ejemplo, { raiz, namespace: process.env.XML_NAMESPACE ?? NAMESPACE });
}

const TIENDA = '27f05c81-c6bf-456a-a273-150e4edb9900';
const LECHE = '5b0d6a0e-1c1e-4f43-9c5b-2a6f1c1e9d77';
const ARROZ = '8c3e1f20-4d5a-4b6c-9d7e-0f1a2b3c4d5e';

export const loteEjemplo = {
  batchId: '6f1c2a9e-3b7d-4e2a-9c41-8d2f0b7a5e10',
  deviceId: 'a3b4c5d6-1111-4222-8333-944455556666',
  contractVersion: '1.0',
  client: 'movil',
  sentAt: '2026-10-30T09:02:00-06:00',
  captures: [
    {
      captureId: 'c0a8012e-7d7c-4b5e-9a51-0d6f3f2a9b11',
      type: 'disponibilidad',
      contractVersion: '1.0',
      capturedAt: '2026-10-26T09:30:00-06:00',
      storeId: TIENDA,
      presentationId: LECHE,
      content: { stock: 12 },
    },
    {
      captureId: 'd1b9023f-8e8d-4c6f-8b62-1e7f4f3bac22',
      type: 'precio_observado',
      contractVersion: '1.0',
      capturedAt: '2026-10-26T09:31:00-06:00',
      storeId: TIENDA,
      presentationId: LECHE,
      content: { price: 27.5, lat: 25.6866, lng: -100.3161 },
    },
    {
      captureId: 'e2ca1340-9f9e-4d70-9c73-2f80a54cbd33',
      type: 'disponibilidad',
      contractVersion: '1.0',
      capturedAt: '2026-10-27T10:00:00-06:00',
      storeId: TIENDA,
      presentationId: ARROZ,
      content: { stock: 0 },
    },
    {
      captureId: 'f3db2451-a0af-4e81-8d84-3091b65dce44',
      type: 'precio_observado',
      contractVersion: '1.0',
      capturedAt: '2026-10-27T10:02:00-06:00',
      storeId: TIENDA,
      presentationId: ARROZ,
      content: { price: -3 },
    },
  ],
};

export const acuseEjemplo = {
  batchId: loteEjemplo.batchId,
  deviceId: loteEjemplo.deviceId,
  userId: '9d2e7f40-5a61-4c1b-8e3f-2b7c9a0d4e55',
  client: 'movil',
  contractVersion: '1.0',
  receivedAt: '2026-10-30T15:02:01.120Z',
  resend: false,
  correlationId: '4b8f0c2e-6a1d-4f3b-9e27-5c0d8a1b3f66',
  summary: { total: 4, aceptadas: 2, duplicadas: 0, conflictos: 1, rechazadas: 1 },
  results: [
    {
      captureId: 'c0a8012e-7d7c-4b5e-9a51-0d6f3f2a9b11',
      type: 'disponibilidad',
      status: 'aceptada',
      capturedAt: '2026-10-26T15:30:00.000Z',
      target: { service: 'availability-service', id: 'c0a8012e-7d7c-4b5e-9a51-0d6f3f2a9b11' },
      reason: null,
      retryable: false,
    },
    {
      captureId: 'd1b9023f-8e8d-4c6f-8b62-1e7f4f3bac22',
      type: 'precio_observado',
      status: 'aceptada',
      capturedAt: '2026-10-26T15:31:00.000Z',
      target: { service: 'pricing-service', id: '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d' },
      reason: null,
      retryable: false,
    },
    {
      captureId: 'e2ca1340-9f9e-4d70-9c73-2f80a54cbd33',
      type: 'disponibilidad',
      status: 'conflicto',
      capturedAt: '2026-10-27T16:00:00.000Z',
      target: { service: 'availability-service', id: 'e2ca1340-9f9e-4d70-9c73-2f80a54cbd33' },
      serverCapturedAt: '2026-10-28T16:00:00.000Z',
      reason: {
        code: 'CONFLICT',
        message:
          'El servidor ya tiene un dato de esta tienda y presentación capturado el 2026-10-28T16:00:00.000Z, más reciente que esta captura. No se sobrescribió; la captura quedó guardada.',
      },
      retryable: false,
    },
    {
      captureId: 'f3db2451-a0af-4e81-8d84-3091b65dce44',
      type: 'precio_observado',
      status: 'rechazada',
      capturedAt: '2026-10-27T16:02:00.000Z',
      target: null,
      reason: { code: 'VALIDATION_ERROR', message: 'content.price debe ser mayor a 0.' },
      retryable: false,
    },
  ],
};

export const reenvioEjemplo = {
  ...acuseEjemplo,
  resend: true,
  summary: { total: 4, aceptadas: 0, duplicadas: 4, conflictos: 0, rechazadas: 0 },
  results: acuseEjemplo.results.map((r) => {
    const { status, ...resto } = r;
    return {
      captureId: resto.captureId,
      type: resto.type,
      status: 'duplicada',
      originalStatus: status,
      capturedAt: resto.capturedAt,
      target: resto.target,
      ...(resto.serverCapturedAt ? { serverCapturedAt: resto.serverCapturedAt } : {}),
      reason: resto.reason,
      retryable: false,
    };
  }),
};

export const listaEjemplo = {
  data: [
    {
      batchId: acuseEjemplo.batchId,
      deviceId: acuseEjemplo.deviceId,
      userId: acuseEjemplo.userId,
      client: 'movil',
      receivedAt: acuseEjemplo.receivedAt,
      summary: acuseEjemplo.summary,
    },
  ],
  total: 1,
  page: 1,
  limit: 20,
};

const ERRORES: Record<number, { code: string; message: string; descripcion: string; details?: string[] }> = {
  400: {
    code: 'VALIDATION_ERROR',
    message: 'La petición no pasó la validación.',
    details: ['captures.0.capturedAt debe ser ISO 8601 con segundos y zona horaria (Z o ±hh:mm)'],
    descripcion: 'Lote mal formado (§4.3): JSON/XML inválido, XSD, campos faltantes, sin zona horaria, captureId repetido.',
  },
  401: { code: 'UNAUTHORIZED', message: 'Sesión inactiva. Vuelve a iniciar sesión.', descripcion: 'Sin token, token inválido o sin sesión en Redis.' },
  403: { code: 'FORBIDDEN', message: 'Tu rol (Gerente de categoría) no tiene permiso sobre esta ruta.', descripcion: 'Rol sin permiso sobre la ruta.' },
  404: { code: 'NOT_FOUND', message: 'Lote no encontrado.', descripcion: 'Lote inexistente o ajeno (mismo cuerpo).' },
  409: {
    code: 'CONFLICT',
    message: 'El batchId ya se usó con otro contenido. Un lote nuevo lleva un batchId nuevo.',
    descripcion: 'batchId con otro contenido, o el mismo lote se está procesando.',
  },
  413: {
    code: 'VALIDATION_ERROR',
    message: 'El lote excede el máximo de 500 capturas (trae 812). Divídelo en lotes más chicos.',
    descripcion: 'Más de 500 capturas o cuerpo mayor a 1 MB.',
  },
  503: {
    code: 'SERVICE_UNAVAILABLE',
    message: 'No se pudo guardar el lote: MongoDB no responde. Reintenta más tarde.',
    descripcion: 'MongoDB o Redis no responden (D-25); no se procesó nada.',
  },
};

export function ApiRespuesta(status: number, descripcion: string, ejemplo: unknown, raizXml: string) {
  return ApiResponse({
    status,
    description: descripcion,
    content: {
      'application/json': { example: ejemplo },
      'application/xml': { example: ejemploXml(ejemplo, raizXml) },
    },
  });
}

/** Igual que `ApiRespuesta`, con varios ejemplos con nombre (cada uno en JSON y en XML). */
export function ApiRespuestaVarias(
  status: number,
  descripcion: string,
  raizXml: string,
  ejemplos: Record<string, { summary: string; value: unknown }>,
) {
  const enXml = Object.fromEntries(
    Object.entries(ejemplos).map(([nombre, e]) => [nombre, { summary: e.summary, value: ejemploXml(e.value, raizXml) }]),
  );
  return ApiResponse({
    status,
    description: descripcion,
    content: {
      'application/json': { examples: ejemplos },
      'application/xml': { examples: enXml },
    },
  });
}

export function cuerpoError(statusCode: number) {
  const e = ERRORES[statusCode];
  return {
    statusCode,
    message: e.message,
    code: e.code,
    details: e.details ?? null,
    path: '/v1/sync/batches',
    timestamp: '2026-10-30T15:02:01.120Z',
  };
}

export function ApiErrores(...statuses: number[]) {
  return applyDecorators(
    ...statuses.map((statusCode) =>
      ApiResponse({
        status: statusCode,
        description: ERRORES[statusCode].descripcion,
        content: {
          'application/json': { example: cuerpoError(statusCode) },
          'application/xml': { example: ejemploXml(cuerpoError(statusCode), 'error') },
        },
      }),
    ),
  );
}

/**
 * `@ApiBody` pone el mismo ejemplo en todos los tipos de contenido. Aquí se
 * reemplaza el de `application/xml` del lote por XML de verdad (raíz
 * `loteSync`), igual al del contrato §4.2.
 */
export function agregarEjemplosXmlDePeticion(documento: OpenAPIObject): OpenAPIObject {
  const operacion = documento.paths['/v1/sync/batches']?.post;
  const cuerpo = operacion?.requestBody as { content?: Record<string, unknown> } | undefined;
  if (cuerpo?.content) {
    cuerpo.content['application/xml'] = {
      schema: { type: 'string', description: 'XML con raíz loteSync (xmlns="sync/v1"), válido contra offline-sync-service.xsd.' },
      example: ejemploXml({ ...loteEjemplo, client: 'escritorio' }, 'loteSync'),
    };
  }
  return documento;
}
