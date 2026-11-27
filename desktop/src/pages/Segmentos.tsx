import { FormEvent, Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Segment,
  SegmentInput,
  SegmentVersion,
  SegmentVersionInput,
  createSegment,
  deleteSegment,
  listSegments,
  listVersions,
  versionSegment,
} from '../api/segmentsApi';
import { extractErrorMessage } from '../api/httpClient';
import { puede } from '../config/menu';
import { useAuth } from '../context/AuthContext';
import BotonesExportar from '../components/BotonesExportar';
import { Columna } from '../utils/exportar';
import Aviso from '../components/Aviso';
import { Cargando, FilaVacia } from '../components/EstadosTabla';
import { Insignia, InsigniaIngreso } from '../components/Insignias';
import { History, Layers, Plus } from 'lucide-react';

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
  { clave: 'version', titulo: 'Versión vigente', valor: (s) => s.version },
  { clave: 'vigente_desde', titulo: 'Vigente desde', valor: (s) => s.versionValidFrom },
];

const fechaHora = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('es-MX');
};
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
  /** Solo al crear una versión nueva: por qué cambió (opcional, máx. 300). */
  changeReason: string;
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
  changeReason: '',
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
    changeReason: '',
  };
}

function rango(s: { incomeRangeMin: number; incomeRangeMax: number | null }): string {
  return s.incomeRangeMax === null
    ? `${dinero(s.incomeRangeMin)} en adelante`
    : `${dinero(s.incomeRangeMin)} – ${dinero(s.incomeRangeMax)}`;
}

export default function Segmentos() {
  const { usuario } = useAuth();
  const rol = usuario?.rol ?? null;
  // D-31 y Matriz §3.2: el Analista comercial crea, versiona y borra; los demás consultan.
  const puedeEditar = puede(rol, 'editarSegmentos');
  const puedeBorrar = puedeEditar;

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

  const [versiones, setVersiones] = useState<{ segmento: Segment; lista: SegmentVersion[] } | null>(null);
  const [errorVersiones, setErrorVersiones] = useState<string | null>(null);

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

  async function verVersiones(s: Segment) {
    setErrorVersiones(null);
    try {
      setVersiones({ segmento: s, lista: await listVersions(s.id) });
    } catch (err) {
      setVersiones(null);
      setErrorVersiones(extractErrorMessage(err));
    }
  }

  function validar(editando: Segment | null): string | null {
    if (!editando && !form.code.trim()) return 'El código es obligatorio.';
    if (!editando && form.code.trim().length > 20) return 'El código admite máximo 20 caracteres.';
    if (!form.name.trim()) return 'El nombre es obligatorio.';
    if (form.name.trim().length > 60) return 'El nombre admite máximo 60 caracteres.';
    const min = Number(form.incomeRangeMin);
    if (form.incomeRangeMin.trim() === '' || Number.isNaN(min)) return 'El ingreso mínimo debe ser un número.';
    if (min < 0) return 'El ingreso mínimo no puede ser negativo.';
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
    if (form.changeReason.trim().length > 300) return 'El motivo del cambio admite máximo 300 caracteres.';
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

  /** Cuerpo del PATCH: lo mismo que el alta, SIN `code` (no se edita, D-35) y con el motivo. */
  function armarVersion(): SegmentVersionInput {
    const { code: _code, ...resto } = armarCuerpo();
    const cuerpo: SegmentVersionInput = resto;
    if (form.changeReason.trim() !== '') cuerpo.changeReason = form.changeReason.trim();
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
        const nuevo = await versionSegment(editando.id, armarVersion());
        setAviso(
          nuevo.version > editando.version
            ? `Segmento «${nuevo.name}»: se creó la versión ${nuevo.version}; la ${editando.version} se conserva.`
            : `Segmento «${nuevo.name}»: no cambió ningún valor, así que no se creó versión.`,
        );
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
    if (!window.confirm(`¿Eliminar el segmento «${s.name}» y sus versiones? Si alguna zona se clasificó con él, el servicio no lo permite.`)) return;
    setAviso(null);
    try {
      await deleteSegment(s.id);
      setAviso(`Segmento «${s.name}» eliminado.`);
      await cargar();
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  }

  if (cargando) return <Cargando texto="Cargando segmentos…" />;

  return (
    <div>
      <h1>Segmentos de ingreso</h1>
      <p className="muted">
        Un segmento clasifica zonas agregadas (nunca personas ni compras). Cada cambio crea una versión nueva con su
        fuente y fecha; la anterior se conserva (D-35). Servicio: income-segmentation-service.
      </p>

      {!puedeEditar && (
        <Aviso tipo="info">Tu rol ({rol}) puede consultar los segmentos, pero no modificarlos.</Aviso>
      )}

      {error && <Aviso tipo="error">{error}</Aviso>}
      {aviso && <Aviso tipo="exito">{aviso}</Aviso>}

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
          aria-label="Buscar segmento"
          placeholder="Buscar por código, nombre o fuente"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
        {puedeEditar && !formAbierto && (
          <button onClick={abrirNuevo}>
            <Plus size={16} aria-hidden="true" />
            Nuevo segmento
          </button>
        )}
      </div>

      {formAbierto && (
        <form className="panel form-grid" onSubmit={guardar}>
          <label>
            Código (máx. 20{formAbierto === 'nuevo' ? '' : '; no se edita'})
            <input
              value={form.code}
              onChange={(e) => cambiar('code', e.target.value)}
              readOnly={formAbierto !== 'nuevo'}
              disabled={formAbierto !== 'nuevo'}
            />
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
          {formAbierto !== 'nuevo' && (
            <label className="wide">
              Motivo del cambio (opcional, máx. 300): queda en la versión nueva
              <textarea rows={2} value={form.changeReason} onChange={(e) => cambiar('changeReason', e.target.value)} />
            </label>
          )}
          <div className="form-actions wide">
            <button type="submit" disabled={guardando}>
              {guardando ? 'Guardando...' : formAbierto === 'nuevo' ? 'Crear segmento' : 'Guardar como versión nueva'}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setFormAbierto(null)} disabled={guardando}>
              Cancelar
            </button>
          </div>
          {errorForm && <Aviso tipo="error" className="wide">{errorForm}</Aviso>}
        </form>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Nombre</th>
              <th className="num">Rango de ingreso</th>
              <th>Frecuencia de actualización</th>
              <th className="num">Versión</th>
              <th className="acciones">
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visibles.length === 0 && (
              <FilaVacia columnas={6} icono={Layers}>{segmentos.length === 0 ? 'Todavía no hay segmentos.' : 'Ningún segmento coincide con la búsqueda.'}</FilaVacia>
            )}
            {visibles.map((s) => (
              <Fragment key={s.id}>
                <tr>
                  <td>
                    <code>{s.code}</code>
                  </td>
                  <td>
                    <InsigniaIngreso nivel={s.name} />
                  </td>
                  <td className="num">{rango(s)}</td>
                  <td>{s.updateFrequency || vacio}</td>
                  <td className="num" title={`Vigente desde ${fechaHora(s.versionValidFrom)}`}>
                    v{s.version}
                  </td>
                  <td className="acciones">
                    <div className="row-actions">
                      <button className="btn-secondary" onClick={() => setExpandido(expandido === s.id ? null : s.id)}>
                        {expandido === s.id ? 'Ocultar' : 'Detalle'}
                      </button>
                      <button className="btn-secondary" onClick={() => verVersiones(s)}>
                        <History size={15} aria-hidden="true" />
                        Versiones
                      </button>
                      {puedeEditar && (
                        <button className="btn-secondary" onClick={() => abrirEdicion(s)}>
                          Nueva versión
                        </button>
                      )}
                      {puedeBorrar && (
                        <button className="btn-danger" onClick={() => borrar(s)}>
                          Eliminar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                {expandido === s.id && (
                  <tr className="detalle">
                    <td colSpan={6}>
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

      {errorVersiones && <Aviso tipo="error">{errorVersiones}</Aviso>}
      {versiones && (
        <section className="panel">
          <h2>
            Versiones de {versiones.segmento.code} ({versiones.lista.length})
          </h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Versión</th>
                  <th>Nombre</th>
                  <th>Rango</th>
                  <th>Fuente</th>
                  <th>Vigente</th>
                  <th>Motivo del cambio</th>
                </tr>
              </thead>
              <tbody>
                {versiones.lista.map((v) => (
                  <tr key={v.version}>
                    <td>
                      v{v.version} {v.current && <Insignia tono="verde">Vigente</Insignia>}
                    </td>
                    <td>{v.name}</td>
                    <td>{rango(v)}</td>
                    <td>{v.source}</td>
                    <td>
                      {fechaHora(v.validFrom)} – {v.validTo ? fechaHora(v.validTo) : 'hoy'}
                    </td>
                    <td>{v.changeReason ?? vacio}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn-secondary" onClick={() => setVersiones(null)}>
            Cerrar
          </button>
        </section>
      )}
    </div>
  );
}