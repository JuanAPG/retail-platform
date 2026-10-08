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

export const muestras = { reporte, estadistica };
