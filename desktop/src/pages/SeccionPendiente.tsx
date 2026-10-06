/** Pantalla temporal de cada sección; se reemplaza una por una conforme las construimos. */
export default function SeccionPendiente({
  titulo,
  descripcion,
  servicio,
}: {
  titulo: string;
  descripcion: string;
  servicio: string;
}) {
  return (
    <div>
      <h1>{titulo}</h1>
      <p>{descripcion}</p>
      <p className="muted">
        Sección en construcción. Consumirá <code>{servicio}</code> en XML.
      </p>
    </div>
  );
}