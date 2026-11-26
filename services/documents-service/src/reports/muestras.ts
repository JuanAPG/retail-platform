/** Ejemplos de Swagger; los mismos objetos generan el JSON y el XML de ejemplo. */
const reporte = {
  id: '6705f1c2a3b4c5d6e7f80912',
  tipo: 'ejecutivo',
  parametros: { dateFrom: '2026-08-01', dateTo: '2026-08-31', zoneId: null, segmentId: null },
  formato: 'json',
  usuarioId: 'a8e46052-34a0-4dda-baf2-40bca267454f',
  estado: 'generado',
  creadoEn: '2026-10-08T18:00:00.000Z',
  secciones: [
    { clave: 'ticket_promedio', nombre: 'Ticket promedio (MXN por canasta)', servicio: 'core-process-service', disponible: true, valor: 86.4, motivo: null },
    { clave: 'elasticidad_promedio', nombre: 'Elasticidad promedio', servicio: 'algorithms-core', disponible: false, valor: null, motivo: 'algorithms-core no respondió en 3 s.' },
  ],
};

const estadistica = { usuarioId: 'a8e46052-34a0-4dda-baf2-40bca267454f', mes: '2026-10', reportes: 3 };

/** Registro de archivo (docs/contratos/registro-archivos.md). */
const archivo = {
  id: '3f0c9a8e-2b1d-4c5e-9f70-1a2b3c4d5e6f',
  versionContrato: 1,
  dominio: 'reportes',
  recursoTipo: 'reporte',
  recursoId: '6705f1c2a3b4c5d6e7f80912',
  formato: 'pdf',
  almacen: 'gcs',
  bucket: 'retail-staging-reportes',
  ruta: 'reportes/2026/10/6705f1c2a3b4c5d6e7f80912/3f0c9a8e-2b1d-4c5e-9f70-1a2b3c4d5e6f-1.pdf',
  tipoContenido: 'application/pdf',
  tamanoBytes: 48213,
  sha256: '9b74c9897bac770ffc029102a200c5de2f1b1f4d1d0a6a4c7b8e1f0c2d3e4f5a',
  propietarioId: 'a8e46052-34a0-4dda-baf2-40bca267454f',
  privacidad: 'privado',
  estado: 'disponible',
  intentos: 1,
  ultimoError: null,
  urlsEmitidas: 0,
  lecturas: 0,
  correlationId: '5d1e2c3b-0a9f-4e8d-b7c6-1f2e3d4c5b6a',
  metadatos: { reporteCreadoEn: '2026-10-08T18:00:00.000Z', tipoReporte: 'ejecutivo', indicadoresNoDisponibles: 1 },
  creadoEn: '2026-10-08T18:01:00.000Z',
  actualizadoEn: '2026-10-08T18:01:02.000Z',
  disponibleEn: '2026-10-08T18:01:02.000Z',
};

const archivoFallido = {
  ...archivo,
  estado: 'fallido',
  ruta: null,
  tamanoBytes: null,
  sha256: null,
  ultimoError: 'GCS save: sin respuesta en 10000 ms',
  disponibleEn: null,
};

const urlDescarga = {
  archivoId: archivo.id,
  url: 'https://storage.googleapis.com/retail-staging-reportes/reportes/2026/10/…?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Expires=300&X-Goog-Signature=…',
  expiraEn: '2026-10-08T18:06:02.000Z',
  ttlSegundos: 300,
  nombre: 'reporte-ejecutivo-2026-10-08.pdf',
  tipoContenido: 'application/pdf',
  tamanoBytes: 48213,
  sha256: archivo.sha256,
};

export const muestras = { reporte, estadistica, archivo, archivoFallido, urlDescarga };
