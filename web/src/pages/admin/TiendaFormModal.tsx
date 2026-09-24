import { FormEvent, useState } from 'react';
import { Modal } from '../../components/Modal';
import { mensajeDeError } from '../../api/errores';
import {
  CrearTiendaPayload,
  crearTienda,
  actualizarTienda,
} from '../../api/catalogo';
import { CodigoPostal, Tienda, Zona } from '../../types';

const FORMATOS: { valor: CrearTiendaPayload['formato']; etiqueta: string }[] = [
  { valor: 'supermercado', etiqueta: 'Supermercado' },
  { valor: 'minimarket', etiqueta: 'Minimarket' },
  { valor: 'tienda_conveniencia', etiqueta: 'Tienda de conveniencia' },
  { valor: 'mayorista', etiqueta: 'Mayorista' },
  { valor: 'otro', etiqueta: 'Otro' },
];

interface TiendaFormModalProps {
  /** `undefined` = alta; con tienda = edición. */
  tienda?: Tienda;
  zonas: Zona[];
  codigosPostales: CodigoPostal[];
  onCerrar: () => void;
  onGuardado: (mensaje: string) => void;
}

export function TiendaFormModal({
  tienda,
  zonas,
  codigosPostales,
  onCerrar,
  onGuardado,
}: TiendaFormModalProps) {
  const esEdicion = !!tienda;

  const [nombre, setNombre] = useState(tienda?.nombre ?? '');
  const [formato, setFormato] = useState<CrearTiendaPayload['formato']>(
    (tienda?.formato as CrearTiendaPayload['formato']) ?? 'supermercado',
  );
  const [zonaId, setZonaId] = useState(tienda?.zonaId ?? zonas[0]?.id ?? '');
  const [numeroSucursal, setNumeroSucursal] = useState(tienda?.numeroSucursal ?? '');
  const [calle, setCalle] = useState(tienda?.direccion?.calle ?? '');
  const [numeroExterior, setNumeroExterior] = useState(tienda?.direccion?.numeroExterior ?? '');
  const [numeroInterior, setNumeroInterior] = useState(tienda?.direccion?.numeroInterior ?? '');
  const [colonia, setColonia] = useState(tienda?.direccion?.colonia ?? '');
  const [codigoPostal, setCodigoPostal] = useState(
    tienda?.direccion?.codigoPostal ?? codigosPostales[0]?.codigoPostal ?? '',
  );
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!zonaId) {
      setError('Selecciona una zona.');
      return;
    }
    if (!codigoPostal) {
      setError('Selecciona un código postal.');
      return;
    }

    const payload: CrearTiendaPayload = {
      nombre: nombre.trim(),
      formato,
      zonaId,
      numeroSucursal: numeroSucursal.trim() || undefined,
      calle: calle.trim(),
      numeroExterior: numeroExterior.trim() || undefined,
      numeroInterior: numeroInterior.trim() || undefined,
      colonia: colonia.trim() || undefined,
      codigoPostal,
    };

    setGuardando(true);
    try {
      if (esEdicion) {
        await actualizarTienda(tienda.id, payload);
        onGuardado('Tienda actualizada correctamente.');
      } else {
        await crearTienda(payload);
        onGuardado('Tienda creada correctamente.');
      }
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo guardar la tienda.'));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      titulo={esEdicion ? 'Editar tienda' : 'Nueva tienda'}
      descripcion="Toda tienda necesita una zona y una dirección con código postal ya catalogado."
      onCerrar={onCerrar}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Campo id="tienda-nombre" label="Nombre">
            <input
              id="tienda-nombre"
              type="text"
              required
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              className={inputClass}
            />
          </Campo>
          <Campo id="tienda-formato" label="Formato">
            <select
              id="tienda-formato"
              value={formato}
              onChange={(e) => setFormato(e.target.value as CrearTiendaPayload['formato'])}
              className={inputClass}
            >
              {FORMATOS.map((f) => (
                <option key={f.valor} value={f.valor}>
                  {f.etiqueta}
                </option>
              ))}
            </select>
          </Campo>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Campo id="tienda-zona" label="Zona">
            <select
              id="tienda-zona"
              value={zonaId}
              onChange={(e) => setZonaId(e.target.value)}
              className={inputClass}
            >
              {zonas.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.nombre}
                </option>
              ))}
            </select>
          </Campo>
          <Campo id="tienda-sucursal" label="No. de sucursal (opcional)">
            <input
              id="tienda-sucursal"
              type="text"
              value={numeroSucursal}
              onChange={(e) => setNumeroSucursal(e.target.value)}
              placeholder="SUC-004"
              className={inputClass}
            />
          </Campo>
        </div>

        <p className="text-xs font-medium uppercase text-slate-400">Dirección</p>

        <Campo id="tienda-calle" label="Calle">
          <input
            id="tienda-calle"
            type="text"
            required
            value={calle}
            onChange={(e) => setCalle(e.target.value)}
            className={inputClass}
          />
        </Campo>

        <div className="grid grid-cols-3 gap-3">
          <Campo id="tienda-num-ext" label="No. exterior">
            <input
              id="tienda-num-ext"
              type="text"
              value={numeroExterior}
              onChange={(e) => setNumeroExterior(e.target.value)}
              className={inputClass}
            />
          </Campo>
          <Campo id="tienda-num-int" label="No. interior">
            <input
              id="tienda-num-int"
              type="text"
              value={numeroInterior}
              onChange={(e) => setNumeroInterior(e.target.value)}
              className={inputClass}
            />
          </Campo>
          <Campo id="tienda-colonia" label="Colonia">
            <input
              id="tienda-colonia"
              type="text"
              value={colonia}
              onChange={(e) => setColonia(e.target.value)}
              className={inputClass}
            />
          </Campo>
        </div>

        <Campo id="tienda-cp" label="Código postal">
          <select
            id="tienda-cp"
            value={codigoPostal}
            onChange={(e) => setCodigoPostal(e.target.value)}
            className={inputClass}
          >
            {codigosPostales.map((cp) => (
              <option key={cp.codigoPostal} value={cp.codigoPostal}>
                {cp.codigoPostal} — {cp.municipio?.nombre}
              </option>
            ))}
          </select>
          {codigosPostales.length === 0 && (
            <p className="mt-1 text-xs text-rose-500">
              No hay códigos postales en el catálogo — pide que agreguen uno primero.
            </p>
          )}
        </Campo>

        {error && (
          <p role="alert" className="rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        )}

        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCerrar}
            className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={guardando || codigosPostales.length === 0}
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {guardando ? 'Guardando…' : esEdicion ? 'Guardar cambios' : 'Crear tienda'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const inputClass =
  'w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500';

function Campo({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium uppercase text-slate-500">
        {label}
      </label>
      {children}
    </div>
  );
}
