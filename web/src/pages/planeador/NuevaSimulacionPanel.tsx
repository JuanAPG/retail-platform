import { FormEvent, useState } from 'react';
import { Hero } from '../../components/ui/Hero';
import { Select } from '../../components/ui/Select';
import { Field } from '../../components/ui/Field';
import { IconSimulacion } from '../../components/ui/icons';
import { mensajeDeError } from '../../api/errores';
import { ResultadoSimulacion, simularCambioPrecio, simularComparacionPresentaciones } from '../../api/simulacion';
import { Producto, Zona } from '../../types';
import { ResultadoSimulacionCard } from './ResultadoSimulacionCard';

type Modo = 'precio' | 'presentacion';

interface Props {
  productos: Producto[];
  zonas: Zona[];
  /** Solo Administrador y Analista comercial pueden simular (mismo criterio que M10/M11). */
  puedeSimular: boolean;
}

export function NuevaSimulacionPanel({ productos, zonas, puedeSimular }: Props) {
  const [modo, setModo] = useState<Modo>('precio');
  const conPresentaciones = productos.filter((p) => p.presentaciones?.length > 0);

  const [presentacionId, setPresentacionId] = useState('');
  const [zonaId, setZonaId] = useState('');
  const [nuevoPrecio, setNuevoPrecio] = useState('');

  const [presentacionA, setPresentacionA] = useState('');
  const [presentacionB, setPresentacionB] = useState('');
  const [zonaComparacion, setZonaComparacion] = useState('');

  const [simulando, setSimulando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoSimulacion | null>(null);

  function cambiarModo(m: Modo) {
    setModo(m);
    setError(null);
    setResultado(null);
  }

  async function simular(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!e.currentTarget.checkValidity()) {
      setError('Completa los campos obligatorios.');
      return;
    }
    setSimulando(true);
    try {
      const r =
        modo === 'precio'
          ? await simularCambioPrecio({ presentationId: presentacionId, zoneId: zonaId, newPrice: Number(nuevoPrecio) })
          : await simularComparacionPresentaciones({
              presentationIdA: presentacionA,
              presentationIdB: presentacionB,
              zoneId: zonaComparacion || undefined,
            });
      setResultado(r);
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo calcular la simulación.'));
    } finally {
      setSimulando(false);
    }
  }

  const opcionesPresentacion = conPresentaciones.flatMap((p) =>
    p.presentaciones.map((pr) => (
      <option key={pr.id} value={pr.id}>
        {p.nombre} · {pr.nombre}
      </option>
    )),
  );

  return (
    <div className="flex flex-col gap-6">
      <Hero
        title="Simulación"
        subtitle="Escenarios hipotéticos de precio o presentación"
        decorations={
          <div className="absolute -top-[54px] right-[100px] flex h-[184px] w-[184px] items-center justify-center rounded-full bg-salvia text-tinta">
            <IconSimulacion className="mt-8 h-[74px] w-[74px]" />
          </div>
        }
      />

      {!puedeSimular && (
        <div className="rounded-full bg-vino/10 px-5 py-3">
          <p className="text-sm font-semibold text-vino">
            Solo Administrador o Analista comercial pueden crear simulaciones nuevas. Consulta las que ya existen en
            Historial.
          </p>
        </div>
      )}

      {puedeSimular && (
        <div className="flex flex-col gap-4 rounded-panel bg-arena p-6">
          <div className="flex w-fit gap-1 rounded-full bg-marfil p-1.5">
            <button
              type="button"
              onClick={() => cambiarModo('precio')}
              className={`h-11 rounded-full px-5 text-sm font-bold transition ${
                modo === 'precio' ? 'bg-teal text-arena' : 'text-teal hover:bg-salvia/25'
              }`}
            >
              Cambio de precio
            </button>
            <button
              type="button"
              onClick={() => cambiarModo('presentacion')}
              className={`h-11 rounded-full px-5 text-sm font-bold transition ${
                modo === 'presentacion' ? 'bg-teal text-arena' : 'text-teal hover:bg-salvia/25'
              }`}
            >
              Comparar presentaciones
            </button>
          </div>

          <form onSubmit={simular} noValidate className="flex flex-col gap-4">
            {modo === 'precio' ? (
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
                <Select id="sim-presentacion" label="Presentación" required value={presentacionId} onChange={(e) => setPresentacionId(e.target.value)} placeholder="Selecciona…">
                  {opcionesPresentacion}
                </Select>
                <Select id="sim-zona" label="Zona" required value={zonaId} onChange={(e) => setZonaId(e.target.value)} placeholder="Selecciona…">
                  {zonas.map((z) => (
                    <option key={z.id} value={z.id}>{z.nombre}</option>
                  ))}
                </Select>
                <Field
                  id="sim-precio"
                  label="Precio nuevo (MXN)"
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={nuevoPrecio}
                  onChange={(e) => setNuevoPrecio(e.target.value)}
                  dataFont
                />
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
                <Select id="sim-pres-a" label="Presentación A" required value={presentacionA} onChange={(e) => setPresentacionA(e.target.value)} placeholder="Selecciona…">
                  {opcionesPresentacion}
                </Select>
                <Select id="sim-pres-b" label="Presentación B" required value={presentacionB} onChange={(e) => setPresentacionB(e.target.value)} placeholder="Selecciona…">
                  {opcionesPresentacion}
                </Select>
                <Select id="sim-zona-comp" label="Zona (opcional)" value={zonaComparacion} onChange={(e) => setZonaComparacion(e.target.value)} placeholder="Nacional">
                  {zonas.map((z) => (
                    <option key={z.id} value={z.id}>{z.nombre}</option>
                  ))}
                </Select>
              </div>
            )}

            <div className="flex items-center justify-between gap-4">
              <p className="text-xs font-semibold text-vino">{error}</p>
              <button
                type="submit"
                disabled={simulando}
                className="flex h-[52px] shrink-0 items-center rounded-full bg-teal px-6 text-[15px] font-bold text-arena transition hover:bg-vino disabled:opacity-50"
              >
                {simulando ? 'Simulando…' : 'Simular'}
              </button>
            </div>
          </form>
        </div>
      )}

      {resultado && <ResultadoSimulacionCard resultado={resultado} />}
    </div>
  );
}
