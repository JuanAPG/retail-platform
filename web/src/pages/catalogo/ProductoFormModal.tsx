import { FormEvent, useState } from 'react';
import { Modal } from '../../components/Modal';
import { mensajeDeError } from '../../api/errores';
import {
  ActualizarProductoPayload,
  CrearProductoDirectoPayload,
  actualizarProducto,
  crearProductoDirecto,
} from '../../api/catalogo';
import { Field } from '../../components/ui/Field';
import { Select } from '../../components/ui/Select';
import { Switch } from '../../components/ui/Switch';
import { TextArea } from '../../components/ui/TextArea';
import { CategoriaProducto, Producto, UnidadMedida } from '../../types';

interface ProductoFormModalProps {
  /** `undefined` = alta directa; con producto = edición. */
  producto?: Producto;
  categorias: CategoriaProducto[];
  unidadesMedida: UnidadMedida[];
  onCerrar: () => void;
  onGuardado: (mensaje: string) => void;
}

/**
 * Alta directa (Admin/Gerente) o edición de un producto. Distinto del
 * flujo de propuesta de Proveedor: aquí el producto nace 'activo' de
 * inmediato y sí se puede marcar `esCanastaBasica` (RN-04, decisión del
 * Gerente, no de quien vende).
 */
export function ProductoFormModal({
  producto,
  categorias,
  unidadesMedida,
  onCerrar,
  onGuardado,
}: ProductoFormModalProps) {
  const esEdicion = !!producto;

  const [sku, setSku] = useState(producto?.sku ?? '');
  const [nombre, setNombre] = useState(producto?.nombre ?? '');
  const [descripcion, setDescripcion] = useState(producto?.descripcion ?? '');
  const [categoriaId, setCategoriaId] = useState<number>(producto?.categoriaId ?? categorias[0]?.id ?? 0);
  const [esCanastaBasica, setEsCanastaBasica] = useState(producto?.esCanastaBasica ?? false);
  // Solo aplican al ALTA: un producto ya existente edita sus
  // presentaciones desde el modal "Presentaciones", no desde aquí.
  const [presentacion, setPresentacion] = useState('1 kg');
  const [contenido, setContenido] = useState('1');
  const [unidadMedida, setUnidadMedida] = useState(unidadesMedida[0]?.clave ?? '');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!e.currentTarget.checkValidity()) {
      setError('Completa los campos obligatorios.');
      return;
    }
    if (!categoriaId) {
      setError('Selecciona una categoría.');
      return;
    }

    setGuardando(true);
    try {
      if (esEdicion) {
        const payload: ActualizarProductoPayload = {
          nombre: nombre.trim(),
          descripcion: descripcion.trim() || undefined,
          categoriaId,
          esCanastaBasica,
        };
        await actualizarProducto(producto.id, payload);
        onGuardado('Producto actualizado correctamente.');
      } else {
        if (!unidadMedida) {
          setError('Selecciona una unidad de medida.');
          setGuardando(false);
          return;
        }
        const payload: CrearProductoDirectoPayload = {
          sku: sku.trim(),
          nombre: nombre.trim(),
          descripcion: descripcion.trim() || undefined,
          categoriaId,
          esCanastaBasica,
          presentacion: presentacion.trim(),
          contenido: Number(contenido),
          unidadMedida,
        };
        await crearProductoDirecto(payload);
        onGuardado('Producto creado correctamente.');
      }
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo guardar el producto.'));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      titulo={esEdicion ? 'Editar producto' : 'Nuevo producto'}
      descripcion={
        esEdicion
          ? 'Las presentaciones se administran aparte, desde «Presentaciones».'
          : 'Nace activo de inmediato — a diferencia de una propuesta de proveedor, no requiere aprobación.'
      }
      onCerrar={onCerrar}
    >
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field id="producto-sku" label="SKU" required disabled={esEdicion} value={sku} onChange={(e) => setSku(e.target.value)} />
          <Field id="producto-nombre" label="Nombre" required value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </div>

        <TextArea
          id="producto-descripcion"
          label="Descripción (opcional)"
          rows={2}
          value={descripcion ?? ''}
          onChange={(e) => setDescripcion(e.target.value)}
        />

        <div className="grid grid-cols-2 items-end gap-3">
          <Select id="producto-categoria" label="Categoría" value={categoriaId} onChange={(e) => setCategoriaId(Number(e.target.value))}>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </Select>
          <div className="pb-3.5">
            <Switch checked={esCanastaBasica} onChange={setEsCanastaBasica}>
              Es canasta básica
            </Switch>
          </div>
        </div>

        {!esEdicion && (
          <>
            <p className="text-xs font-bold uppercase tracking-wide text-salvia">Primera presentación</p>
            <div className="grid grid-cols-3 gap-3">
              <Field
                id="producto-presentacion"
                label="Nombre"
                required
                value={presentacion}
                onChange={(e) => setPresentacion(e.target.value)}
              />
              <Field
                id="producto-contenido"
                label="Contenido"
                type="number"
                required
                min={0}
                step="0.001"
                value={contenido}
                onChange={(e) => setContenido(e.target.value)}
                dataFont
              />
              <Select id="producto-unidad" label="Unidad" value={unidadMedida} onChange={(e) => setUnidadMedida(e.target.value)}>
                {unidadesMedida.map((u) => (
                  <option key={u.clave} value={u.clave}>
                    {u.clave} — {u.nombre}
                  </option>
                ))}
              </Select>
            </div>
          </>
        )}

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
            disabled={guardando}
            className="flex h-11 items-center rounded-full bg-vino px-5 text-sm font-bold text-arena transition hover:bg-teal disabled:opacity-50"
          >
            {guardando ? 'Guardando…' : esEdicion ? 'Guardar cambios' : 'Crear producto'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
