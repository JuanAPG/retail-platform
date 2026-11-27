import { ReactNode } from 'react';

/*
 * Insignias de color reutilizables. Los colores solo distinguen categorías: en el nivel de ingreso
 * ninguno significa "bueno" o "malo" (bajo ámbar, medio azul, alto verde azulado, como la app móvil).
 */

export type Tono = 'ambar' | 'azul' | 'teal' | 'verde' | 'rojo' | 'morado' | 'gris';

export function Insignia({ tono, children, titulo }: { tono: Tono; children: ReactNode; titulo?: string }) {
  return (
    <span className={`insignia insignia-${tono}`} title={titulo}>
      {children}
    </span>
  );
}

function sinAcentos(texto: string): string {
  return texto.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

/** Nivel de ingreso a partir del nombre del segmento ("Ingreso bajo") o su código (ING_1…). */
export function tonoIngreso(texto: string | null | undefined): Tono {
  const t = sinAcentos(texto ?? '');
  const palabras = new Set(t.split(/[^a-z0-9_]+/));
  if (palabras.has('bajo') || palabras.has('ing_1')) return 'ambar';
  if (palabras.has('medio') || palabras.has('ing_2')) return 'azul';
  if (palabras.has('alto') || palabras.has('ing_3')) return 'teal';
  return 'gris';
}

export function InsigniaIngreso({ nivel }: { nivel: string | null | undefined }) {
  if (!nivel) return <span className="muted">—</span>;
  return <Insignia tono={tonoIngreso(nivel)}>{nivel}</Insignia>;
}

const TONO_ESTADO_PROMOCION: Record<string, Tono> = { pendiente: 'ambar', aprobada: 'verde', rechazada: 'rojo' };
const TEXTO_ESTADO_PROMOCION: Record<string, string> = { pendiente: 'Pendiente', aprobada: 'Aprobada', rechazada: 'Rechazada' };

export function InsigniaEstadoPromocion({ estado }: { estado: string }) {
  return <Insignia tono={TONO_ESTADO_PROMOCION[estado] ?? 'gris'}>{TEXTO_ESTADO_PROMOCION[estado] ?? estado}</Insignia>;
}

const TONO_VIGENCIA: Record<string, Tono> = { programada: 'azul', vigente: 'verde', vencida: 'gris' };
const TEXTO_VIGENCIA: Record<string, string> = { programada: 'Programada', vigente: 'Vigente', vencida: 'Vencida' };

export function InsigniaVigencia({ vigencia }: { vigencia: string | null }) {
  if (!vigencia) return null;
  return <Insignia tono={TONO_VIGENCIA[vigencia] ?? 'gris'}>{TEXTO_VIGENCIA[vigencia] ?? vigencia}</Insignia>;
}

/** Clasificación de elasticidad (D-18): elástica, unitaria (0.95 ≤ |E| ≤ 1.05) o inelástica. */
const TONO_ELASTICIDAD: Record<string, Tono> = { elastic: 'morado', unitary: 'azul', inelastic: 'teal' };
const TEXTO_ELASTICIDAD: Record<string, string> = { elastic: 'Elástica', unitary: 'Unitaria', inelastic: 'Inelástica' };

export function InsigniaElasticidad({ clase }: { clase: string | null }) {
  if (!clase) return <span className="muted">—</span>;
  return <Insignia tono={TONO_ELASTICIDAD[clase] ?? 'gris'}>{TEXTO_ELASTICIDAD[clase] ?? clase}</Insignia>;
}

const TONO_SEGUIMIENTO: Record<string, Tono> = { asignada: 'ambar', en_implementacion: 'azul', implementada: 'teal', evaluada: 'verde' };
const TEXTO_SEGUIMIENTO: Record<string, string> = {
  asignada: 'Asignada',
  en_implementacion: 'En implementación',
  implementada: 'Implementada',
  evaluada: 'Evaluada',
};

export function InsigniaSeguimiento({ estado }: { estado: string }) {
  return <Insignia tono={TONO_SEGUIMIENTO[estado] ?? 'gris'}>{TEXTO_SEGUIMIENTO[estado] ?? estado}</Insignia>;
}

/** Estado genérico: verde si es positivo, rojo si no (activa/inactiva, completada/fallida…). */
export function InsigniaSiNo({ si, textoSi, textoNo }: { si: boolean; textoSi: string; textoNo: string }) {
  return <Insignia tono={si ? 'verde' : 'rojo'}>{si ? textoSi : textoNo}</Insignia>;
}
