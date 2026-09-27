/**
 * Animación en loop para los paneles decorativos de Login/Registro:
 * una persona entrega un producto, un camión lo traslada y llega a un
 * anaquel que se transforma en una tiendita. Todo en CSS (sin librerías),
 * con la misma familia visual de trazo que el resto de íconos del sitio.
 */
export function IlustracionCadenaSuministro() {
  return (
    <svg
      viewBox="0 0 240 90"
      className="h-[70px] w-full max-w-[280px] text-arena"
      fill="none"
      aria-hidden="true"
    >
      {/* Camino guía, puramente decorativo y estático. */}
      <path d="M40 66h136" stroke="currentColor" strokeOpacity={0.18} strokeWidth={2} strokeDasharray="1 8" strokeLinecap="round" />

      {/* Persona */}
      <g className="text-arena" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="20" cy="30" r="6" />
        <path d="M9 58v-8a11 11 0 0 1 22 0v8" />
      </g>

      {/* Paquete que pasa de la mano de la persona al camión. */}
      <rect x="28" y="42" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth={2} className="origin-center animate-cadena-caja text-salvia" />

      {/* Camión que recorre el panel llevando el producto. */}
      <g className="animate-cadena-camion text-salvia" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 62V46h20v16M26 52h9l6 6v4" />
        <rect x="14" y="50" width="6" height="6" rx="1" />
        <circle cx="14" cy="64" r="3.5" />
        <circle cx="35" cy="64" r="3.5" />
      </g>

      {/* Anaquel: visible al inicio, se desvanece cuando llega el camión. */}
      <g className="animate-cadena-anaquel text-arena" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <rect x="180" y="26" width="30" height="38" rx="2" />
        <path d="M180 39h30M180 52h30" />
      </g>

      {/* Tiendita: aparece cuando el anaquel se desvanece (misma posición). */}
      <g className="animate-cadena-tienda text-salvia" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M177 40l18-15 18 15" />
        <path d="M181 40v24h28V40" />
        <path d="M191 64V50h8v14" />
        <path d="M177 40l4 6M213 40l-4 6M186 40l3 6M204 40l-3 6" strokeOpacity={0.6} />
      </g>
    </svg>
  );
}
