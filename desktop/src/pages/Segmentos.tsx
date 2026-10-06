import { FormEvent, Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Segment,
  SegmentInput,
  createSegment,
  deleteSegment,
  listSegments,
  updateSegment,
} from '../api/segmentsApi';
import { extractErrorMessage } from '../api/httpClient';
import { puedeEscribir } from '../config/menu';
import { useAuth } from '../context/AuthContext';
import BotonesExportar from '../components/BotonesExportar';
import { Columna } from '../utils/exportar';

const vacio = '—';
const COLUMNAS_SEGMENTOS: Columna<Segment>[] = [
  { clave: 'codigo', titulo: 'Código', valor: (s) => s.code },
  { clave: 'nombre', titulo: 'Nombre', valor: (s) => s.name },
  { clave: 'ingreso_minimo', titulo: 'Ingreso mínimo', valor: (s) => s.incomeRangeMin },
  { clave: 'ingreso_maximo', titulo: 'Ingreso máximo', valor: (s) => s.incomeRangeMax },
  { clave: 'fuente', titulo: 'Fuente', valor: (s) => s.source },
  { clave: 'frecuencia_actualizacion', titulo: 'Frecuencia de actualización', valor: (s) => s.updateFrequency },
  { clave: 'relacion_zona', titulo: 'Relación con la zona', valor: (s) => s.zoneRelation },
  { clave: 'limitaciones', titulo: 'Limitaciones', valor: (s) => s.limitations },
  { clave: 'descripcion', titulo: 'Descripción', valor: (s) => s.description },
];
const dinero = (n: number) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

function normalizar(texto: string): string {
  return texto.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

interface FormState {
  code: string;
  name: string;
  incomeRangeMin: string;
  incomeRangeMax: string;
  source: string;
  updateFrequency: string;
  zoneRelation: string;
  limitations: string;
  description: string;
}

const FORM_VACIO: FormState = {
  code: '',
  name: '',
  incomeRangeMin: '',
  incomeRangeMax: '',
  source: '',
  updateFrequency: '',
  zoneRelation: 'Se asigna a la ZONA agregada (RN-02); nunca a una persona ni compra individual.',
  limitations: '',
  description: '',
};

function formDesde(s: Segment): FormState {
  return {
    code: s.code,
    name: s.name,
    incomeRangeMin: String(s.incomeRangeMin),
    incomeRangeMax: s.incomeRangeMax === null ? '' : String(s.incomeRangeMax),
    source: s.source,
    updateFrequency: s.updateFrequency,
    zoneRelation: s.zoneRelation,
    limitations: s.limitations,
    description: s.description ?? '',
  };
}

function rango(s: Segment): string {
  return s.incomeRangeMax === null
    ? `${dinero(s.incomeRangeMin)} en adelante`
    : `${dinero(s.incomeRangeMin)} – ${dinero(s.incomeRangeMax)}`;
}

export default function Segmentos() {
  const { usuario } = useAuth();
  const rol = usuario?.rol ?? null;
  const puedeEditar = puedeEscribir(rol);
  const puedeBorrar = rol === 'Administrador';

  const [segmentos, setSegmentos] = useState<Segment[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [expandido, setExpandido] = useState<number | null>(null);

  const [formAbierto, setFormAbierto] = useState<'nuevo' | Segment | null>(null);
  const [form, setForm] = useState<FormState>(FORM_VACIO);
  const [errorForm, setErrorForm] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setSegmentos(await listSegments());
      setError(null);
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const visibles = useMemo(() => {
    const q = normalizar(busqueda.trim());
    if (!q) return segmentos;
    return segmentos.filter((s) => normalizar(`${s.code} ${s.name} ${s.source}`).includes(q));
  }, [segmentos, busqueda]);

  function abrirNuevo() {
    setForm(FORM_VACIO);
    setErrorForm(null);
    setAviso(null);
    setFormAbierto('nuevo');
  }

  function abrirEdicion(s: Segment) {
    setForm(formDesde(s));
    setErrorForm(null);
    setAviso(null);
    setFormAbierto(s);
  }

  function cambiar(campo: keyof FormState, valor: string) {
    setForm((previo) => ({ ...previo, [campo]: valor }));
  }

  function validar(editando: Segment | null): string | null {
    if (!form.code.trim()) return 'El código es obligatorio.';
    if (form.code.trim().length > 20) return 'El código admite máximo 20 caracteres.';
    if (!form.name.trim()) return 'El nombre es obligatorio.';
    if (form.name.trim().length > 60) return 'El nombre admite máximo 60 caracteres.';
    const min = Number(form.incomeRangeMin);
    if (form.incomeRangeMin.trim() === '' || Number.isNaN(min)) return 'El ingreso mínimo debe ser un número.';
    if (form.incomeRangeMax.trim() !== '') {
      const max = Number(form.incomeRangeMax);
      if (Number.isNaN(max) || max <= 0) return 'El ingreso máximo debe ser un número positivo.';
      if (max <= min) return 'El ingreso máximo debe ser mayor que el mínimo.';
    } else if (editando && editando.incomeRangeMax !== null) {
      return 'El servicio no permite quitar el tope de un segmento ya creado. Escribe un nuevo máximo.';
    }
    if (!form.source.trim()) return 'La fuente del rango es obligatoria.';
    if (!form.updateFrequency.trim()) return 'La frecuencia de actualización es obligatoria.';
    if (form.updateFrequency.trim().length > 60) return 'La frecuencia admite máximo 60 caracteres.';
    if (!form.zoneRelation.trim()) return 'La relación con la zona es obligatoria.';
    if (!form.limitations.trim()) return 'Las limitaciones son obligatorias.';
    return null;
  }

  function armarCuerpo(): SegmentInput {
    const cuerpo: SegmentInput = {
      code: form.code.trim(),
      name: form.name.trim(),
      incomeRangeMin: Number(form.incomeRangeMin),
      source: form.source.trim(),
      updateFrequency: form.updateFrequency.trim(),
      zoneRelation: form.zoneRelation.trim(),
      limitations: form.limitations.trim(),
    };
    if (form.incomeRangeMax.trim() !== '') cuerpo.incomeRangeMax = Number(form.incomeRangeMax);
    if (form.description.trim() !== '') cuerpo.description = form.description.trim();
    return cuerpo;
  }

  async function guardar(e: FormEvent) {
    e.preventDefault();
    const editando = formAbierto !== 'nuevo' && formAbierto !== null ? formAbierto : null;
    const problema = validar(editando);
    if (problema) {
      setErrorForm(problema);
      return;
    }
    setErrorForm(null);
    setGuardando(true);
    try {
      if (editando) {
        await updateSegment(editando.id, armarCuerpo());
        setAviso(`Segmento «${form.name.trim()}» actualizado.`);
      } else {
        await createSegment(armarCuerpo());
        setAviso(`Segmento «${form.name.trim()}» creado.`);
      }
      setFormAbierto(null);
      await cargar();
    } catch (err) {
      setErrorForm(extractErrorMessage(err));
    } finally {
      setGuardando(false);
    }
  }

  async function borrar(s: Segment) {
    if (!window.confirm(`¿Eliminar el segmento «${s.name}»? Esta acción no se puede deshacer.`)) return;
    setAviso(null);
    try {
      await deleteSegment(s.id);
      setAviso(`Segmento «${s.name}» eliminado.`);
      await cargar();
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  }

  if (cargando) return <p>Cargando segmentos...</p>;

  return (
    <div>
      <h1>Segmentos de ingreso</h1>
      <p className="muted">
        Un segmento clasifica zonas agregadas (nunca personas ni compras). Cada uno justifica su fuente, su frecuencia
        de actualización y sus limitaciones.
      </p>

      {!puedeEditar && (
        <p className="alert-info">Tu rol ({rol}) puede consultar los segmentos, pero no modificarlos.</p>
      )}

      {error && <p className="alert-error">{error}</p>}
      {aviso && <p className="alert-info">{aviso}</p>}

      <div className="toolbar">
        <BotonesExportar
            nombreArchivo="segmentos-ingreso"
            raizXml="segmentos"
            filaXml="segmento"
            columnas={COLUMNAS_SEGMENTOS}
            filas={visibles}
        />
        <input
          type="search"
          placeholder="Buscar por código, nombre o fuente"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
        {puedeEditar && !formAbierto && <button onClick={abrirNuevo}>Nuevo segmento</button>}
      </div>

      {formAbierto && (
        <form className="panel form-grid" onSubmit={guardar}>
          <label>
            Código (máx. 20)
            <input value={form.code} onChange={(e) => cambiar('code', e.target.value)} />
          </label>
          <label>
            Nombre (máx. 60)
            <input value={form.name} onChange={(e) => cambiar('name', e.target.value)} />
          </label>
          <label>
            Ingreso mínimo
            <input
              value={form.incomeRangeMin}
              onChange={(e) => cambiar('incomeRangeMin', e.target.value)}
              inputMode="decimal"
            />
          </label>
          <label>
            Ingreso máximo (vacío = sin tope)
            <input
              value={form.incomeRangeMax}
              onChange={(e) => cambiar('incomeRangeMax', e.target.value)}
              inputMode="decimal"
            />
          </label>
          <label className="wide">
            Fuente del rango
            <input value={form.source} onChange={(e) => cambiar('source', e.target.value)} />
          </label>
          <label className="wide">
            Frecuencia de actualización (máx. 60)
            <input value={form.updateFrequency} onChange={(e) => cambiar('updateFrequency', e.target.value)} />
          </label>
          <label className="wide">
            Relación con la zona
            <textarea
              rows={2}
              value={form.zoneRelation}
              onChange={(e) => cambiar('zoneRelation', e.target.value)}
            />
          </label>
          <label className="wide">
            Limitaciones
            <textarea rows={2} value={form.limitations} onChange={(e) => cambiar('limitations', e.target.value)} />
          </label>
          <label className="wide">
            Descripción (opcional)
            <textarea rows={2} value={form.description} onChange={(e) => cambiar('description', e.target.value)} />
          </label>
          <div className="form-actions wide">
            <button type="submit" disabled={guardando}>
              {guardando ? 'Guardando...' : formAbierto === 'nuevo' ? 'Crear segmento' : 'Guardar cambios'}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setFormAbierto(null)} disabled={guardando}>
              Cancelar
            </button>
          </div>
          {errorForm && <p className="alert-error wide">{errorForm}</p>}
        </form>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Nombre</th>
              <th>Rango de ingreso</th>
              <th>Frecuencia de actualización</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visibles.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  {segmentos.length === 0 ? 'Todavía no hay segmentos.' : 'Ningún segmento coincide con la búsqueda.'}
                </td>
              </tr>
            )}
            {visibles.map((s) => (
              <Fragment key={s.id}>
                <tr>
                  <td>{s.code}</td>
                  <td>{s.name}</td>
                  <td>{rango(s)}</td>
                  <td>{s.updateFrequency || vacio}</td>
                  <td className="row-actions">
                    <button className="btn-secondary" onClick={() => setExpandido(expandido === s.id ? null : s.id)}>
                      {expandido === s.id ? 'Ocultar' : 'Detalle'}
                    </button>
                    {puedeEditar && (
                      <button className="btn-secondary" onClick={() => abrirEdicion(s)}>
                        Editar
                      </button>
                    )}
                    {puedeBorrar && (
                      <button className="btn-danger" onClick={() => borrar(s)}>
                        Eliminar
                      </button>
                    )}
                  </td>
                </tr>
                {expandido === s.id && (
                  <tr className="detalle">
                    <td colSpan={5}>
                      <p>
                        <strong>Fuente:</strong> {s.source}
                      </p>
                      <p>
                        <strong>Relación con la zona:</strong> {s.zoneRelation}
                      </p>
                      <p>
                        <strong>Limitaciones:</strong> {s.limitations}
                      </p>
                      {s.description && (
                        <p>
                          <strong>Descripción:</strong> {s.description}
                        </p>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">
        {visibles.length} de {segmentos.length} segmentos
      </p>
    </div>
  );
}