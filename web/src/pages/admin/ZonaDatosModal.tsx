import { FormEvent, useState } from 'react';
import { Modal } from '../../components/Modal';
import { Cargando } from '../../components/Cargando';
import { EstadoError } from '../../components/EstadoError';
import { Field } from '../../components/ui/Field';
import { Select } from '../../components/ui/Select';
import { ErrorText } from '../../components/ui/ErrorText';
import { useFetch } from '../../hooks/useFetch';
import { mensajeDeError } from '../../api/errores';
import { listaSegura } from '../../api/seguro';
import { cargarIndicadoresZona, clasificarZona } from '../../api/catalogo';
import { getSegmentos } from '../../api/segmentos';
import { IncomeSegment, Zona } from '../../types';

interface ZonaDatosModalProps {
  zona: Zona;
  onCerrar: () => void;
  onGuardado: (mensaje: string) => void;
}

const botonPrimario =
  'flex h-11 items-center rounded-full bg-vino px-5 text-sm font-bold text-arena transition hover:bg-teal disabled:opacity-50';

/**
 * CAT-12 / CAT-13 — Datos analíticos de una zona, solo para el Analista comercial:
 * indicadores cargados a mano (con fuente y periodo, para que sean trazables) y
 * clasificación en un segmento de ingreso. La clasificación es de la ZONA agregada,
 * nunca de una persona (reglas de negocio).
 */
export function ZonaDatosModal({ zona, onCerrar, onGuardado }: ZonaDatosModalProps) {
  const segmentos = useFetch(getSegmentos, []);

  const [ingreso, setIngreso] = useState('');
  const [poblacion, setPoblacion] = useState('');
  const [disponibilidad, setDisponibilidad] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [fuente, setFuente] = useState('');
  const [errorInd, setErrorInd] = useState<string | null>(null);
  const [guardandoInd, setGuardandoInd] = useState(false);

  const [segmentoId, setSegmentoId] = useState('');
  const [errorSeg, setErrorSeg] = useState<string | null>(null);
  const [guardandoSeg, setGuardandoSeg] = useState(false);

  async function guardarIndicadores(e: FormEvent) {
    e.preventDefault();
    setErrorInd(null);
    const i = Number(ingreso);
    const p = Number(poblacion);
    const d = Number(disponibilidad);
    if (ingreso === '' || !Number.isFinite(i) || i < 0) return setErrorInd('El ingreso estimado debe ser un número mayor o igual a 0.');
    if (poblacion === '' || !Number.isFinite(p) || p < 0) return setErrorInd('La población debe ser un número mayor o igual a 0.');
    if (disponibilidad === '' || !Number.isFinite(d) || d < 0 || d > 1) return setErrorInd('La disponibilidad es una proporción entre 0 y 1 (por ejemplo 0.85).');
    if (!desde || !hasta) return setErrorInd('Indica el periodo de los datos (desde y hasta).');
    if (desde > hasta) return setErrorInd('El periodo inicia después de terminar.');
    if (!fuente.trim()) return setErrorInd('La fuente es obligatoria: de ahí sale la trazabilidad del dato.');
    setGuardandoInd(true);
    try {
      await cargarIndicadoresZona(zona.id, {
        ingresoEstimado: i,
        poblacion: p,
        disponibilidad: d,
        periodoInicio: desde,
        periodoFin: hasta,
        fuente: fuente.trim(),
      });
      onGuardado(`Indicadores de «${zona.nombre}» guardados.`);
    } catch (err) {
      setErrorInd(mensajeDeError(err, 'No se pudieron guardar los indicadores.'));
    } finally {
      setGuardandoInd(false);
    }
  }

  async function guardarSegmento(e: FormEvent) {
    e.preventDefault();
    setErrorSeg(null);
    if (!segmentoId) return setErrorSeg('Elige el segmento de ingreso de la zona.');
    setGuardandoSeg(true);
    try {
      await clasificarZona(zona.id, Number(segmentoId));
      onGuardado(`«${zona.nombre}» clasificada en el segmento elegido.`);
    } catch (err) {
      setErrorSeg(mensajeDeError(err, 'No se pudo clasificar la zona.'));
    } finally {
      setGuardandoSeg(false);
    }
  }

  const lista = listaSegura<IncomeSegment>(segmentos.data);

  return (
    <Modal
      titulo={`Datos de ${zona.nombre}`}
      descripcion="Indicadores y segmento de ingreso de la zona. Son datos agregados de la zona, no de personas."
      onCerrar={onCerrar}
    >
      <div className="flex flex-col gap-8">
        <form noValidate onSubmit={guardarIndicadores} className="flex flex-col gap-4">
          <h3 className="font-slab text-xl text-vino">Indicadores</h3>
          <Field id="zd-ingreso" label="Ingreso mensual estimado del hogar (MXN)" type="number" min="0" value={ingreso} onChange={(e) => setIngreso(e.target.value)} />
          <Field id="zd-poblacion" label="Población estimada" type="number" min="0" value={poblacion} onChange={(e) => setPoblacion(e.target.value)} />
          <Field
            id="zd-disp"
            label="Disponibilidad de básicos (0 a 1)"
            type="number"
            min="0"
            max="1"
            step="0.01"
            value={disponibilidad}
            onChange={(e) => setDisponibilidad(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-3">
            <Field id="zd-desde" label="Periodo desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
            <Field id="zd-hasta" label="Periodo hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </div>
          <Field id="zd-fuente" label="Fuente" maxLength={200} placeholder="INEGI - Censo 2020" value={fuente} onChange={(e) => setFuente(e.target.value)} />
          {errorInd && <ErrorText>{errorInd}</ErrorText>}
          <div className="flex justify-end">
            <button type="submit" disabled={guardandoInd} className={botonPrimario}>
              {guardandoInd ? 'Guardando…' : 'Guardar indicadores'}
            </button>
          </div>
        </form>

        <form noValidate onSubmit={guardarSegmento} className="flex flex-col gap-4">
          <h3 className="font-slab text-xl text-vino">Segmento de ingreso</h3>
          {segmentos.loading && !segmentos.data && <Cargando etiqueta="Cargando segmentos…" />}
          {segmentos.error && <EstadoError mensaje={segmentos.error} onReintentar={segmentos.reintentable ? segmentos.refetch : undefined} />}
          {segmentos.data && (
            <Select id="zd-segmento" label="Clasificar la zona en" value={segmentoId} onChange={(e) => setSegmentoId(e.target.value)} placeholder="Elige un segmento">
              {lista.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.code})
                </option>
              ))}
            </Select>
          )}
          <p className="text-xs text-teal/70">La clasificación anterior se conserva en el historial; la nueva pasa a ser la vigente.</p>
          {errorSeg && <ErrorText>{errorSeg}</ErrorText>}
          <div className="flex justify-end">
            <button type="submit" disabled={guardandoSeg || !segmentos.data} className={botonPrimario}>
              {guardandoSeg ? 'Guardando…' : 'Guardar segmento'}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
