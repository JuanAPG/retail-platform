import { FormEvent, useState } from 'react';
import { Modal } from '../../components/Modal';
import { mensajeDeError } from '../../api/errores';
import {
  CrearTiendaPayload,
  crearTienda,
  actualizarTienda,
} from '../../api/catalogo';
import { Field } from '../../components/ui/Field';
import { Select } from '../../components/ui/Select';
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
          <Field id="tienda-nombre" label="Nombre" required value={nombre} onChange={(e) => setNombre(e.target.value)} />
          <Select
            id="tienda-formato"
            label="Formato"
            value={formato}
            onChange={(e) => setFormato(e.target.value as CrearTiendaPayload['formato'])}
          >
            {FORMATOS.map((f) => (
              <option key={f.valor} value={f.valor}>
                {f.etiqueta}
              </option>
            ))}
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Select id="tienda-zona" label="Zona" value={zonaId} onChange={(e) => setZonaId(e.target.value)}>
            {zonas.map((z) => (
              <option key={z.id} value={z.id}>
                {z.nombre}
              </option>
            ))}
          </Select>
          <Field
            id="tienda-sucursal"
            label="No. de sucursal (opcional)"
            value={numeroSucursal}
            onChange={(e) => setNumeroSucursal(e.target.value)}
            placeholder="SUC-004"
          />
        </div>

        <p className="text-xs font-bold uppercase tracking-wide text-salvia">Dirección</p>

        <Field id="tienda-calle" label="Calle" required value={calle} onChange={(e) => setCalle(e.target.value)} />

        <div className="grid grid-cols-3 gap-3">
          <Field id="tienda-num-ext" label="No. exterior" value={numeroExterior} onChange={(e) => setNumeroExterior(e.target.value)} />
          <Field id="tienda-num-int" label="No. interior" value={numeroInterior} onChange={(e) => setNumeroInterior(e.target.value)} />
          <Field id="tienda-colonia" label="Colonia" value={colonia} onChange={(e) => setColonia(e.target.value)} />
        </div>

        <div>
          <Select id="tienda-cp" label="Código postal" value={codigoPostal} onChange={(e) => setCodigoPostal(e.target.value)}>
            {codigosPostales.map((cp) => (
              <option key={cp.codigoPostal} value={cp.codigoPostal}>
                {cp.codigoPostal} — {cp.municipio?.nombre}
              </option>
            ))}
          </Select>
          {codigosPostales.length === 0 && (
            <p className="mt-1.5 text-xs font-semibold text-vino">
              No hay códigos postales en el catálogo — pide que agreguen uno primero.
            </p>
          )}
        </div>

        {error && (
          <p role="alert" className="rounded-full bg-vino/10 px-4 py-2.5 text-sm font-semibold text-vino">
            {error}
          </p>
        )}

        <div className="mt-2 flex justify-end gap-2.5">
          <button
            type="button"
            onClick={onCerrar}
            className="flex h-11 items-center rounded-full border-2 border-salvia/60 px-5 text-sm font-bold text-teal transition hover:bg-salvia hover:text-tinta"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={guardando || codigosPostales.length === 0}
            className="flex h-11 items-center rounded-full bg-vino px-5 text-sm font-bold text-arena transition hover:bg-teal disabled:opacity-50"
          >
            {guardando ? 'Guardando…' : esEdicion ? 'Guardar cambios' : 'Crear tienda'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
