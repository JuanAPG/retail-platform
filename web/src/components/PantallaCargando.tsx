/** Splash que se muestra mientras se revalida la sesión guardada. */
export function PantallaCargando() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-marfil">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-teal font-display text-lg font-extrabold text-arena">
        ra
      </div>
      <p className="text-sm font-semibold text-teal">Verificando sesión…</p>
    </div>
  );
}
