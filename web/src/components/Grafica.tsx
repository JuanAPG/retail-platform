import { lazy, Suspense } from 'react';
import type Highcharts from 'highcharts';
import { Cargando } from './Cargando';

// Highcharts pesa: se descarga solo cuando una pantalla con gráficas se abre.
const GraficaHighcharts = lazy(() => import('./GraficaHighcharts'));

/** Envoltura con carga diferida: mientras baja la librería se ve el indicador de carga. */
export function Grafica({ opciones, altura }: { opciones: Highcharts.Options; altura?: number }) {
  return (
    <Suspense fallback={<Cargando etiqueta="Cargando gráfica…" />}>
      <GraficaHighcharts opciones={opciones} altura={altura} />
    </Suspense>
  );
}
