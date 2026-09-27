import { useCallback, useRef, useState } from 'react';

export const FILL_DURATION = 0.5;
export const FILL_EASE = [0.16, 1, 0.3, 1] as const;

/** Diámetro mínimo para que un círculo, creciendo desde (x, y), cubra todo el rectángulo. */
function coverDiameter(width: number, height: number, x: number, y: number): number {
  return Math.ceil(
    2 *
      Math.max(
        Math.hypot(x, y),
        Math.hypot(width - x, y),
        Math.hypot(x, height - y),
        Math.hypot(width - x, height - y),
      ),
  );
}

/**
 * Estado + manejadores para el relleno circular que crece desde el punto
 * donde el usuario hace hover/click/foco (reemplaza el simple cambio de
 * color por transición CSS en los botones principales del sitio).
 */
export function useOriginFill<T extends HTMLElement>(disabled?: boolean) {
  const ref = useRef<T>(null);
  const [activo, setActivo] = useState(false);
  const [origen, setOrigen] = useState({ x: 0, y: 0 });
  const [diametro, setDiametro] = useState(0);

  const actualizarOrigen = useCallback((x: number, y: number) => {
    const nodo = ref.current;
    if (!nodo) return;
    const rect = nodo.getBoundingClientRect();
    setOrigen({ x, y });
    setDiametro(coverDiameter(rect.width, rect.height, x, y));
  }, []);

  const desdePuntero = useCallback(
    (e: React.PointerEvent<T>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      actualizarOrigen(e.clientX - rect.left, e.clientY - rect.top);
    },
    [actualizarOrigen],
  );

  const desdeCentro = useCallback(() => {
    const nodo = ref.current;
    if (!nodo) return;
    const rect = nodo.getBoundingClientRect();
    actualizarOrigen(rect.width / 2, rect.height / 2);
  }, [actualizarOrigen]);

  const handlers = {
    onPointerEnter: (e: React.PointerEvent<T>) => {
      if (disabled) return;
      desdePuntero(e);
      setActivo(true);
    },
    onPointerDown: (e: React.PointerEvent<T>) => {
      if (disabled || e.button !== 0) return;
      desdePuntero(e);
      setActivo(true);
    },
    onPointerLeave: () => setActivo(false),
    onPointerCancel: () => setActivo(false),
    onFocus: (e: React.FocusEvent<T>) => {
      if (disabled) return;
      if (e.currentTarget.matches(':focus-visible')) {
        desdeCentro();
        setActivo(true);
      }
    },
    onBlur: () => setActivo(false),
  };

  return { ref, origen, diametro, mostrarRelleno: !disabled && activo, handlers };
}
