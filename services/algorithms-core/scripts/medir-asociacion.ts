/**
 * Medición de Apriori y FP-Growth para la ficha del algoritmo (docs/ficha-algoritmo-complejo.md).
 *
 *   npm run medir:asociacion -- --datos ../../db/generados/10000 --salida ../../carga/resultados/asociacion-10k
 *
 * Lee las canastas de los `ventas-*.csv` del generador (db/README-generador.md): una canasta por folio
 * con sus productos SIN repetir (dos presentaciones del mismo producto cuentan una vez), igual que
 * `LINEAS_DE_CANASTA_SQL` de `fuente-datos`. Así se mide el algoritmo sin la base ni HTTP, sobre
 * exactamente los datos que se cargan.
 *
 * Por cada soporte de la rejilla corre los dos algoritmos sobre la MISMA foto de los datos (el
 * mismo hash que `fotoDe`, D-15), mide tiempo y memoria, junta las estadísticas de trabajo
 * (candidatos, podas, nodos del árbol) y comprueba que den los mismos itemsets y reglas en el mismo
 * orden (D2, RF-14). Si difieren, termina con código 1.
 *
 * La confianza no cambia el trabajo de minado (solo filtra reglas al final): se corre con una
 * confianza mínima baja y se cuentan las reglas que pasarían 0.3, 0.5 y 0.8.
 */
import { createHash } from 'crypto';
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { apriori, AprioriParams, AprioriResult, estadisticasVacias, EstadisticasAsociacion } from '../src/association/apriori';
import { fpGrowth } from '../src/association/fpgrowth';

const SOPORTES = [0.2, 0.1, 0.05, 0.02, 0.01, 0.005];
const CONFIANZA_DE_CORRIDA = 0.05;
const CONFIANZAS_REPORTADAS = [0.3, 0.5, 0.8];

interface Corrida {
  algoritmo: 'apriori' | 'fpgrowth';
  ms: number;
  memoriaMiB: number;
  itemsets: number;
  reglas: Record<string, number>;
  estadisticas: EstadisticasAsociacion;
}

function argumento(nombre: string, porDefecto?: string): string {
  const i = process.argv.indexOf(`--${nombre}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (porDefecto !== undefined) return porDefecto;
  throw new Error(`Falta --${nombre}`);
}

/** Canastas por folio con sus SKU sin repetir, en el orden del archivo. */
export function leerCanastas(carpeta: string): string[][] {
  const porFolio = new Map<string, Set<string>>();
  const archivos = readdirSync(carpeta).filter((a) => /^ventas-\d+\.csv$/.test(a)).sort();
  if (archivos.length === 0) throw new Error(`No hay ventas-*.csv en ${carpeta}`);
  for (const archivo of archivos) {
    const lineas = readFileSync(join(carpeta, archivo), 'utf-8').split('\n');
    const columnas = lineas[0].trim().split(',');
    const iFolio = columnas.indexOf('folio');
    const iSku = columnas.indexOf('sku');
    for (const linea of lineas.slice(1)) {
      if (!linea.trim()) continue;
      const campos = linea.split(',');
      const folio = campos[iFolio];
      let productos = porFolio.get(folio);
      if (!productos) porFolio.set(folio, (productos = new Set()));
      productos.add(campos[iSku]);
    }
  }
  return [...porFolio.values()].map((s) => [...s]);
}

/** El mismo hash que `fotoDe` (association.service.ts): canastas como conjuntos ordenados, en orden. */
export function foto(canastas: string[][]): string {
  const canonicas = canastas.map((b) => [...new Set(b)].sort().join(',')).sort();
  return createHash('sha256').update(canonicas.join('\n')).digest('hex');
}

function correr(algoritmo: Corrida['algoritmo'], canastas: string[][], params: AprioriParams): [Corrida, AprioriResult] {
  const estadisticas = estadisticasVacias();
  const gc = (global as { gc?: () => void }).gc;
  gc?.();
  const antes = process.memoryUsage().heapUsed;
  const inicio = process.hrtime.bigint();
  const resultado = (algoritmo === 'apriori' ? apriori : fpGrowth)(canastas, params, estadisticas);
  const ms = Number(process.hrtime.bigint() - inicio) / 1e6;
  const memoriaMiB = Math.max(0, process.memoryUsage().heapUsed - antes) / 1024 ** 2;
  const reglas = Object.fromEntries(
    CONFIANZAS_REPORTADAS.map((c) => [String(c), resultado.rules.filter((r) => r.confidence >= c - 1e-9).length]),
  );
  return [{ algoritmo, ms: +ms.toFixed(1), memoriaMiB: +memoriaMiB.toFixed(1), itemsets: resultado.itemsets.length,
            reglas, estadisticas }, resultado];
}

function tabla(volumen: string, filas: { soporte: number; apriori: Corrida; fpgrowth: Corrida; iguales: boolean }[]) {
  const n = (m: Record<number, number>, k: number) => m[k] ?? 0;
  const lineas = [
    `## ${volumen}`, '',
    '| Soporte | Conteo mín. | Frecuentes 1/2/3 | Candidatos 2/3 (podados 3) | Pruebas de contención | Nodos árbol inicial / total (árboles) | Reglas ≥0.3/0.5/0.8 | Apriori ms | FP-Growth ms | Iguales |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const f of filas) {
    const a = f.apriori.estadisticas;
    const p = f.fpgrowth.estadisticas;
    lineas.push(
      `| ${f.soporte} | ${a.conteoMinimo} | ${n(a.frecuentesPorTamano, 1)}/${n(a.frecuentesPorTamano, 2)}/${n(a.frecuentesPorTamano, 3)} | ` +
        `${n(a.candidatosPorTamano, 2)}/${n(a.candidatosPorTamano, 3)} (${n(a.podadosPorTamano, 3)}) | ` +
        `${a.pruebasDeContencion.toLocaleString('en-US')} | ${p.nodosArbolInicial} / ${p.nodos} (${p.arboles}) | ` +
        `${CONFIANZAS_REPORTADAS.map((c) => f.apriori.reglas[String(c)]).join('/')} | ${f.apriori.ms} | ${f.fpgrowth.ms} | ` +
        `${f.iguales ? 'sí' : '**NO**'} |`,
    );
  }
  return lineas.join('\n');
}

function main() {
  const carpeta = argumento('datos');
  const salida = argumento('salida');
  const maxItemsetSize = Number(argumento('tamano-maximo', '3'));
  const inicio = process.hrtime.bigint();
  const canastas = leerCanastas(carpeta);
  const lecturaMs = Number(process.hrtime.bigint() - inicio) / 1e6;
  const hash = foto(canastas);
  const lineasDeCanasta = canastas.reduce((s, c) => s + c.length, 0);
  const productos = new Set(canastas.flat()).size;
  console.log(`${carpeta}: ${canastas.length} canastas, ${productos} productos, ${lineasDeCanasta} productos-canasta; ` +
              `foto ${hash.slice(0, 12)}… (lectura ${lecturaMs.toFixed(0)} ms)`);

  const filas = [];
  let todasIguales = true;
  for (const soporte of SOPORTES) {
    const params = { minSupport: soporte, minConfidence: CONFIANZA_DE_CORRIDA, maxItemsetSize };
    const [a, ra] = correr('apriori', canastas, params);
    const [p, rp] = correr('fpgrowth', canastas, params);
    const iguales = JSON.stringify(ra) === JSON.stringify(rp);
    todasIguales &&= iguales;
    filas.push({ soporte, apriori: a, fpgrowth: p, iguales });
    console.log(`  soporte ${soporte}: ${a.itemsets} itemsets, ${ra.rules.length} reglas · Apriori ${a.ms} ms · ` +
                `FP-Growth ${p.ms} ms · ${iguales ? 'iguales' : 'DISTINTOS'}`);
  }
  const volumen = `${canastas.length.toLocaleString('en-US')} canastas (${carpeta.split(/[\\/]/).pop()})`;
  const resultado = {
    datos: carpeta, canastas: canastas.length, productos, lineasDeCanasta, foto: hash, maxItemsetSize,
    confianzaDeCorrida: CONFIANZA_DE_CORRIDA, node: process.version, lecturaMs: +lecturaMs.toFixed(1), filas,
    todasIguales,
  };
  mkdirSync(dirname(salida), { recursive: true });
  writeFileSync(`${salida}.json`, JSON.stringify(resultado, null, 1));
  writeFileSync(`${salida}.md`, `${tabla(volumen, filas)}\n\nFoto ${hash} · tamaño máximo ${maxItemsetSize} · ` +
                                `Node ${process.version}\n`);
  console.log(`Listo: ${salida}.md`);
  process.exit(todasIguales ? 0 : 1);
}

if (require.main === module) main();
