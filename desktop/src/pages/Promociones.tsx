import { FormEvent, useEffect, useMemo, useState } from 'react';
import { listProducts, listStores, listZones } from '../api/catalogApi';
import { Producto, Tienda, Zone } from '../api/catalogParsers';
import { extractErrorMessage } from '../api/httpClient';
import {
  ComparacionPromociones,
  ESTADOS_PROMOCION,
  FiltrosPromocion,
  MOTIVO_MAX,
  MOTIVO_MIN,
  NOMBRE_ESTADO,
  NOMBRE_TIPO,
  NOMBRE_VIGENCIA,
  PrecioUnitario,
  Promocion,
  TIPOS_PROMOCION,
  aprobarPromocion,
  bandejaPendientes,
  camposDelTipo,
  compararPromociones,
  listarPromociones,
  mensajeConflictoPromocion,
  motivoNoComparable,
  precioUnitario,
  rechazarPromocion,
} from '../api/promotionApi';
import BotonesExportar from '../components/BotonesExportar';
import { puede } from '../config/menu';
import { useAuth } from '../context/AuthContext';
import { Columna } from '../utils/exportar';
import type { FilaComparacion } from '../api/promotionApi';

/*
 * Promociones (promotion-service, D-39). Los 3 perfiles del escritorio leen, calculan el precio
 * unitario y comparan. Solo el Responsable de precios aprueba o rechaza. Nadie propone desde aquí:
 * proponer es del Gerente de categoría, que no entra al escritorio (D-31), así que el botón no existe.
 * Un dato no disponible se muestra con su motivo, nunca como 0.
 */

const vacio = '—';
const dinero = (n: number | null) => (n === null ? vacio : n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }));
const pct = (n: number | null) => (n === null ? vacio : `${n.toLocaleString('es-MX', { maximumFractionDigits: 2 })} %`);
const cantidad = (n: number | null) => (n === null ? vacio : n.toLocaleString('es-MX', { maximumFractionDigits: 3 }));
const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-MX') : vacio);

export default function Promociones() {
  const { usuario } = useAuth();
  const puedeResolver = puede(usuario?.rol, 'resolverPromociones');

  const [productos, setProductos] = useState<Producto[]>([]);
  const [zonas, setZonas] = useState<Zone[]>([]);
  const [tiendas, setTiendas] = useState<Tienda[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const [pendientes, setPendientes] = useState<Promocion[]>([]);
  const [filtros, setFiltros] = useState<FiltrosPromocion>({});
  const [lista, setLista] = useState<Promocion[]>([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(false);

  const [seleccion, setSeleccion] = useState<Promocion | null>(null);
  const [motivo, setMotivo] = useState('');
  const [resolviendo, setResolviendo] = useState(false);
  const [errorDetalle, setErrorDetalle] = useState<string | null>(null);

  const [tiendaCalculo, setTiendaCalculo] = useState('');
  const [unitario, setUnitario] = useState<PrecioUnitario | null>(null);
  const [errorUnitario, setErrorUnitario] = useState<string | null>(null);

  const [marcadas, setMarcadas] = useState<string[]>([]);
  const [tiendaComparar, setTiendaComparar] = useState('');
  const [comparacion, setComparacion] = useState<ComparacionPromociones | null>(null);
  const [errorComparar, setErrorComparar] = useState<string | null>(null);

  // Nombres legibles (si catalog falla, se muestran los ids).
  const nombreProducto = (id: string) => productos.find((p) => p.id === id)?.nombre ?? id;
  const nombrePresentacion = (productId: string, id: string) =>
    productos.find((p) => p.id === productId)?.presentaciones.find((x) => x.id === id)?.nombre ?? id;
  const nombreZona = (id: string | null) => (id ? (zonas.find((z) => z.id === id)?.nombre ?? id) : null);
  const nombreTienda = (id: string | null) => (id ? (tiendas.find((t) => t.id === id)?.nombre ?? id) : null);
  const ambito = (p: Promocion) => (p.storeId ? `Tienda: ${nombreTienda(p.storeId)}` : `Zona: ${nombreZona(p.zoneId)}`);

  const columnas: Columna<Promocion>[] = [
    { clave: 'nombre', titulo: 'Promoción', valor: (p) => p.name },
    { clave: 'tipo', titulo: 'Tipo', valor: (p) => NOMBRE_TIPO[p.type] ?? p.type },
    { clave: 'condicion', titulo: 'Condición', valor: (p) => camposDelTipo(p) },
    { clave: 'producto', titulo: 'Producto', valor: (p) => nombreProducto(p.productId) },
    { clave: 'presentacion', titulo: 'Presentación', valor: (p) => nombrePresentacion(p.productId, p.presentationId) },
    { clave: 'ambito', titulo: 'Ámbito', valor: (p) => ambito(p) },
    { clave: 'desde', titulo: 'Desde', valor: (p) => p.validFrom },
    { clave: 'hasta', titulo: 'Hasta', valor: (p) => p.validTo },
    { clave: 'estado', titulo: 'Estado', valor: (p) => NOMBRE_ESTADO[p.status] ?? p.status },
    { clave: 'vigencia', titulo: 'Vigencia', valor: (p) => (p.validity ? NOMBRE_VIGENCIA[p.validity] : '') },
    { clave: 'id', titulo: 'Id', valor: (p) => p.id },
  ];

  const columnasComparacion: Columna<FilaComparacion>[] = [
    { clave: 'promocion', titulo: 'Promoción', valor: (f) => lista.find((p) => p.id === f.promotionId)?.name ?? f.promotionId },
    { clave: 'tipo', titulo: 'Tipo', valor: (f) => NOMBRE_TIPO[f.type] ?? f.type },
    { clave: 'disponible', titulo: 'Disponible', valor: (f) => f.disponible },
    { clave: 'precio_unitario', titulo: 'Precio promocional por unidad (MXN)', valor: (f) => f.unitPrice },
    { clave: 'precio_unitario_regular', titulo: 'Precio regular por unidad (MXN)', valor: (f) => f.regularUnitPrice },
    { clave: 'ahorro_pct', titulo: 'Ahorro %', valor: (f) => f.savingsPct },
    { clave: 'motivo', titulo: 'Motivo', valor: (f) => f.motivo },
  ];

  async function cargarPendientes() {
    if (!puedeResolver) return;
    try {
      setPendientes((await bandejaPendientes()).promociones);
    } catch (e) {
      setError(extractErrorMessage(e));
    }
  }

  async function cargarLista(f: FiltrosPromocion = filtros) {
    setCargando(true);
    try {
      const r = await listarPromociones(f);
      setLista(r.promociones);
      setTotal(r.total);
      setError(null);
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    listProducts().then(setProductos).catch(() => undefined);
    listZones().then(setZonas).catch(() => undefined);
    listStores().then(setTiendas).catch(() => undefined);
    cargarPendientes();
    cargarLista({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Tiendas donde se puede calcular la promoción: la suya, o las activas de su zona. */
  const tiendasDe = (p: Promocion | null) =>
    !p ? [] : p.storeId ? tiendas.filter((t) => t.id === p.storeId) : tiendas.filter((t) => t.zonaId === p.zoneId);

  function abrir(p: Promocion) {
    setSeleccion(p);
    setMotivo('');
    setErrorDetalle(null);
    setUnitario(null);
    setErrorUnitario(null);
    setTiendaCalculo(p.storeId ?? '');
  }

  async function despuesDeResolver(actualizada: Promocion | null, mensaje: string) {
    setAviso(mensaje);
    if (actualizada) setSeleccion(actualizada);
    await Promise.all([cargarPendientes(), cargarLista()]);
  }

  async function aprobar() {
    if (!seleccion) return;
    setResolviendo(true);
    setErrorDetalle(null);
    try {
      const p = await aprobarPromocion(seleccion.id);
      await despuesDeResolver(p, `Promoción "${p.name}" aprobada.`);
    } catch (e) {
      const conflicto = mensajeConflictoPromocion(e);
      setErrorDetalle(conflicto ?? extractErrorMessage(e));
      if (conflicto) await despuesDeResolver(null, '');
    } finally {
      setResolviendo(false);
    }
  }

  async function rechazar(e: FormEvent) {
    e.preventDefault();
    if (!seleccion) return;
    const texto = motivo.trim();
    if (texto.length < MOTIVO_MIN || texto.length > MOTIVO_MAX) {
      return setErrorDetalle(`El motivo debe tener entre ${MOTIVO_MIN} y ${MOTIVO_MAX} caracteres.`);
    }
    setResolviendo(true);
    setErrorDetalle(null);
    try {
      const p = await rechazarPromocion(seleccion.id, texto);
      setMotivo('');
      await despuesDeResolver(p, `Promoción "${p.name}" rechazada.`);
    } catch (err) {
      const conflicto = mensajeConflictoPromocion(err);
      setErrorDetalle(conflicto ?? extractErrorMessage(err));
      if (conflicto) await despuesDeResolver(null, '');
    } finally {
      setResolviendo(false);
    }
  }

  async function calcularUnitario() {
    if (!seleccion) return;
    if (seleccion.zoneId && !tiendaCalculo) return setErrorUnitario('Elige una tienda de la zona.');
    setErrorUnitario(null);
    try {
      setUnitario(await precioUnitario(seleccion.id, tiendaCalculo || undefined));
    } catch (e) {
      setUnitario(null);
      setErrorUnitario(extractErrorMessage(e));
    }
  }

  const promosMarcadas = useMemo(() => lista.filter((p) => marcadas.includes(p.id)), [lista, marcadas]);
  const productoMarcado = promosMarcadas[0]?.productId ?? null;

  function marcar(p: Promocion, si: boolean) {
    setComparacion(null);
    setMarcadas((m) => (si ? [...m, p.id] : m.filter((id) => id !== p.id)));
  }

  async function comparar() {
    const motivoNo = motivoNoComparable(promosMarcadas);
    if (motivoNo) return setErrorComparar(motivoNo);
    if (!tiendaComparar) return setErrorComparar('Elige la tienda donde se comparan.');
    setErrorComparar(null);
    try {
      setComparacion(await compararPromociones(marcadas, tiendaComparar));
    } catch (e) {
      setComparacion(null);
      setErrorComparar(extractErrorMessage(e));
    }
  }

  function filtrar(e: FormEvent) {
    e.preventDefault();
    cargarLista(filtros);
  }

  const cambiarFiltro = (campo: keyof FiltrosPromocion, valor: string) => setFiltros((f) => ({ ...f, [campo]: valor || undefined }));

  return (
    <div>
      <h1>Promociones</h1>
      <p className="muted">
        Servicios: promotion-service (promociones, precio unitario y comparación) y catalog-service (nombres de
        productos, zonas y tiendas). Las promociones no tocan el histórico de precios ni la elasticidad (D-39). Las
        propone el Gerente de categoría desde la web.
      </p>
      {error && <p className="alert-error">{error}</p>}
      {aviso && <p className="alert-info">{aviso}</p>}

      {puedeResolver && (
        <>
          <h2>Bandeja de pendientes ({pendientes.length})</h2>
          <p className="muted">La más antigua primero. Revisa el precio unitario antes de aprobar.</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Propuesta</th>
                  <th>Promoción</th>
                  <th>Tipo</th>
                  <th>Condición</th>
                  <th>Vigencia</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pendientes.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted">
                      No hay promociones pendientes.
                    </td>
                  </tr>
                )}
                {pendientes.map((p) => (
                  <tr key={p.id}>
                    <td>{fecha(p.proposedAt)}</td>
                    <td>{p.name}</td>
                    <td>{NOMBRE_TIPO[p.type] ?? p.type}</td>
                    <td>{camposDelTipo(p)}</td>
                    <td>
                      {p.validFrom} a {p.validTo} {p.validity && <span className="pill">{NOMBRE_VIGENCIA[p.validity]}</span>}
                    </td>
                    <td>
                      <button type="button" onClick={() => abrir(p)}>
                        Revisar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {seleccion && (
        <section className="panel">
          <div className="toolbar">
            <h2 style={{ margin: 0 }}>{seleccion.name}</h2>
            <button type="button" className="btn-secondary" onClick={() => setSeleccion(null)}>
              Cerrar
            </button>
          </div>
          <dl className="detalle">
            <dt>Tipo</dt>
            <dd>{NOMBRE_TIPO[seleccion.type] ?? seleccion.type}</dd>
            <dt>Condición</dt>
            <dd>{camposDelTipo(seleccion)}</dd>
            <dt>Producto</dt>
            <dd>
              {nombreProducto(seleccion.productId)} · {nombrePresentacion(seleccion.productId, seleccion.presentationId)}
            </dd>
            <dt>Ámbito</dt>
            <dd>{ambito(seleccion)}</dd>
            <dt>Vigencia</dt>
            <dd>
              {seleccion.validFrom} a {seleccion.validTo} (inclusive){' '}
              {seleccion.validity && <span className="pill">{NOMBRE_VIGENCIA[seleccion.validity]}</span>}
            </dd>
            <dt>Estado</dt>
            <dd>{NOMBRE_ESTADO[seleccion.status] ?? seleccion.status}</dd>
            <dt>Propuesta</dt>
            <dd>
              {fecha(seleccion.proposedAt)} · usuario {seleccion.proposedBy}
            </dd>
            {seleccion.resolvedAt && (
              <>
                <dt>Resuelta</dt>
                <dd>
                  {fecha(seleccion.resolvedAt)} · usuario {seleccion.resolvedBy}
                </dd>
              </>
            )}
            {seleccion.rejectionReason && (
              <>
                <dt>Motivo del rechazo</dt>
                <dd>{seleccion.rejectionReason}</dd>
              </>
            )}
          </dl>

          <h3>Precio unitario en una tienda</h3>
          <div className="toolbar">
            <select value={tiendaCalculo} onChange={(e) => setTiendaCalculo(e.target.value)}>
              <option value="">{seleccion.storeId ? 'Su tienda' : 'Elige una tienda de la zona'}</option>
              {tiendasDe(seleccion).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre}
                </option>
              ))}
            </select>
            <button type="button" onClick={calcularUnitario}>
              Calcular precio unitario
            </button>
          </div>
          {errorUnitario && <p className="alert-error">{errorUnitario}</p>}
          {unitario && (
            <div className="table-wrap">
              {!unitario.disponible && <p className="alert-info">No disponible: {unitario.motivo ?? 'sin motivo'}</p>}
              <table>
                <thead>
                  <tr>
                    <th />
                    <th>Precio de compra</th>
                    <th>Contenido</th>
                    <th>Precio por {unitario.baseUnit}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Regular</td>
                    {unitario.regular.disponible ? (
                      <>
                        <td>
                          {dinero(unitario.regular.price)}
                          {unitario.regular.effectiveDate ? ` (desde ${unitario.regular.effectiveDate})` : ''}
                        </td>
                        <td>
                          {cantidad(unitario.regular.contentBase)} {unitario.baseUnit}
                        </td>
                        <td>{dinero(unitario.regular.unitPrice)} MXN/{unitario.baseUnit}</td>
                      </>
                    ) : (
                      <td colSpan={3} className="muted">
                        No disponible: {unitario.regular.motivo ?? 'sin precio vigente'}
                      </td>
                    )}
                  </tr>
                  <tr>
                    <td>Promocional</td>
                    {unitario.promotional ? (
                      <>
                        <td>
                          {dinero(unitario.promotional.purchasePrice)} ({unitario.promotional.items} pza)
                        </td>
                        <td>
                          {cantidad(unitario.promotional.contentBase)} {unitario.baseUnit}
                        </td>
                        <td>
                          <strong>{dinero(unitario.promotional.unitPrice)}</strong> MXN/{unitario.baseUnit}
                        </td>
                      </>
                    ) : (
                      <td colSpan={3} className="muted">
                        No se puede calcular
                      </td>
                    )}
                  </tr>
                </tbody>
              </table>
              <p>
                Ahorro por unidad:{' '}
                <strong>{unitario.savingsPct === null ? 'no disponible (falta el precio regular)' : pct(unitario.savingsPct)}</strong>
              </p>
            </div>
          )}

          {puedeResolver && seleccion.status === 'pendiente' && (
            <>
              <h3>Resolver</h3>
              <div className="toolbar">
                <button type="button" onClick={aprobar} disabled={resolviendo}>
                  Aprobar
                </button>
              </div>
              <form className="form-grid" onSubmit={rechazar}>
                <label className="wide">
                  Motivo del rechazo ({MOTIVO_MIN} a {MOTIVO_MAX} caracteres)
                  <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={MOTIVO_MAX} rows={3} />
                </label>
                <div className="form-actions">
                  <button type="submit" className="btn-danger" disabled={resolviendo}>
                    Rechazar
                  </button>
                </div>
              </form>
            </>
          )}
          {errorDetalle && <p className="alert-error">{errorDetalle}</p>}
        </section>
      )}

      <h2>Todas las promociones ({total})</h2>
      <form className="panel form-grid" onSubmit={filtrar}>
        <label>
          Estado
          <select value={filtros.status ?? ''} onChange={(e) => cambiarFiltro('status', e.target.value)}>
            <option value="">Todos</option>
            {ESTADOS_PROMOCION.map((s) => (
              <option key={s} value={s}>
                {NOMBRE_ESTADO[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tipo
          <select value={filtros.type ?? ''} onChange={(e) => cambiarFiltro('type', e.target.value)}>
            <option value="">Todos</option>
            {TIPOS_PROMOCION.map((t) => (
              <option key={t} value={t}>
                {NOMBRE_TIPO[t]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Zona
          <select value={filtros.zoneId ?? ''} onChange={(e) => cambiarFiltro('zoneId', e.target.value)}>
            <option value="">Todas</option>
            {zonas.map((z) => (
              <option key={z.id} value={z.id}>
                {z.nombre}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tienda
          <select value={filtros.storeId ?? ''} onChange={(e) => cambiarFiltro('storeId', e.target.value)}>
            <option value="">Todas</option>
            {tiendas.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nombre}
              </option>
            ))}
          </select>
        </label>
        <label>
          Vigentes el día (aprobadas)
          <input type="date" value={filtros.activeOn ?? ''} onChange={(e) => cambiarFiltro('activeOn', e.target.value)} />
        </label>
        <div className="form-actions">
          <button type="submit" disabled={cargando}>
            {cargando ? 'Buscando...' : 'Filtrar'}
          </button>
        </div>
      </form>

      <div className="toolbar">
        <BotonesExportar nombreArchivo="promociones" raizXml="promociones" filaXml="promocion" columnas={columnas} filas={lista} />
        <span className="muted">Comparar ({marcadas.length} elegidas, del mismo producto, de 2 a 10):</span>
        <select value={tiendaComparar} onChange={(e) => setTiendaComparar(e.target.value)}>
          <option value="">Tienda</option>
          {tiendas.map((t) => (
            <option key={t.id} value={t.id}>
              {t.nombre}
            </option>
          ))}
        </select>
        <button type="button" onClick={comparar} disabled={marcadas.length < 2}>
          Comparar
        </button>
      </div>
      {errorComparar && <p className="alert-error">{errorComparar}</p>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Comparar</th>
              <th>Promoción</th>
              <th>Tipo</th>
              <th>Condición</th>
              <th>Producto</th>
              <th>Ámbito</th>
              <th>Vigencia</th>
              <th>Estado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lista.length === 0 && (
              <tr>
                <td colSpan={9} className="muted">
                  No hay promociones con esos filtros.
                </td>
              </tr>
            )}
            {lista.map((p) => {
              const elegida = marcadas.includes(p.id);
              const otroProducto = productoMarcado !== null && p.productId !== productoMarcado;
              return (
                <tr key={p.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={elegida}
                      disabled={!elegida && (otroProducto || marcadas.length >= 10)}
                      title={otroProducto ? 'Solo se comparan promociones del mismo producto' : undefined}
                      onChange={(e) => marcar(p, e.target.checked)}
                    />
                  </td>
                  <td>{p.name}</td>
                  <td>{NOMBRE_TIPO[p.type] ?? p.type}</td>
                  <td>{camposDelTipo(p)}</td>
                  <td>
                    {nombreProducto(p.productId)} · {nombrePresentacion(p.productId, p.presentationId)}
                  </td>
                  <td>{ambito(p)}</td>
                  <td>
                    {p.validFrom} a {p.validTo} {p.validity && <span className="pill">{NOMBRE_VIGENCIA[p.validity]}</span>}
                  </td>
                  <td>{NOMBRE_ESTADO[p.status] ?? p.status}</td>
                  <td>
                    <button type="button" className="btn-secondary" onClick={() => abrir(p)}>
                      Detalle
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {comparacion && (
        <section>
          <h2>Comparación en {nombreTienda(comparacion.storeId)}</h2>
          <p className="muted">
            {nombreProducto(comparacion.productId)} · de la más barata a la más cara por {comparacion.baseUnit} (MXN/
            {comparacion.baseUnit}). Presentaciones distintas se comparan solo normalizadas (D-06).
          </p>
          <div className="toolbar">
            <BotonesExportar
              nombreArchivo="comparacion-promociones"
              raizXml="comparacionPromociones"
              filaXml="promocion"
              columnas={columnasComparacion}
              filas={comparacion.filas}
            />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Tipo</th>
                  <th>Presentación</th>
                  <th>Precio promocional / {comparacion.baseUnit}</th>
                  <th>Regular / {comparacion.baseUnit}</th>
                  <th>Ahorro</th>
                </tr>
              </thead>
              <tbody>
                {comparacion.filas.map((f, i) => (
                  <tr key={f.promotionId}>
                    <td>{i + 1}</td>
                    <td>{NOMBRE_TIPO[f.type] ?? f.type}</td>
                    <td>{nombrePresentacion(comparacion.productId, f.presentationId)}</td>
                    {f.disponible ? (
                      <>
                        <td>
                          <strong>{dinero(f.unitPrice)}</strong>
                        </td>
                        <td>{dinero(f.regularUnitPrice)}</td>
                        <td>{pct(f.savingsPct)}</td>
                      </>
                    ) : (
                      <td colSpan={3} className="muted">
                        No disponible: {f.motivo ?? 'sin motivo'}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
