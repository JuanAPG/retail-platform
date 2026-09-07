/** Splash que se muestra mientras se revalida la sesión guardada. */
export function PantallaCargando() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-100">
      <div className="flex h-10 w-10 items-center justify-center rounded bg-slate-900 text-sm font-semibold text-slate-100">
        RA
      </div>
      <p className="text-sm text-slate-500">Verificando sesión…</p>
    </div>
  );
}
