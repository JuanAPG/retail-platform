import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';
import 'highcharts/highcharts-more'; // telaraña (polar) y burbujas
import 'highcharts/modules/treemap'; // mapa de árbol
import { COLORES } from './coloresGrafica';

const BASE: Highcharts.Options = {
  chart: { backgroundColor: 'transparent', style: { fontFamily: 'Figtree, system-ui, sans-serif' }, spacingTop: 16 },
  colors: [COLORES.teal, COLORES.salvia, COLORES.vino, '#B8A98A', '#4F6F68'],
  title: { text: undefined },
  credits: { enabled: true, text: 'Highcharts', href: 'https://www.highcharts.com' },
  lang: { noData: 'Sin datos para mostrar', thousandsSep: ',', decimalPoint: '.' },
  noData: { style: { color: COLORES.teal, fontWeight: '600' } },
  accessibility: { enabled: true },
  legend: { itemStyle: { color: COLORES.teal } },
  tooltip: { borderRadius: 16, backgroundColor: '#FAF8F2', borderColor: COLORES.salvia, shadow: false },
  xAxis: { labels: { style: { color: COLORES.teal } }, lineColor: COLORES.salvia },
  yAxis: { labels: { style: { color: COLORES.teal } }, gridLineColor: 'rgba(112,141,129,.25)', title: { style: { color: COLORES.teal } } },
  plotOptions: { series: { animation: { duration: 500 } } },
};

/**
 * Gráfica dinámica con Highcharts (instructivo del proyecto). Se carga por separado
 * (ver `Grafica`) porque la librería pesa y no todas las pantallas la necesitan.
 * `opciones` se mezcla con la base visual; al cambiar los datos la gráfica se anima sola.
 */
export default function GraficaHighcharts({ opciones, altura = 320 }: { opciones: Highcharts.Options; altura?: number }) {
  const mezcla = Highcharts.merge(BASE, { chart: { height: altura } }, opciones);
  return <HighchartsReact highcharts={Highcharts} options={mezcla} containerProps={{ style: { width: '100%' } }} />;
}
