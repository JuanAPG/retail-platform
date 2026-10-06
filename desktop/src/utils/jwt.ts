export interface JwtPayload {
  sub?: string;
  email?: string;
  rol?: string;
  rolId?: number;
  jti?: string;
  /** Segundos desde 1970 (estándar JWT). */
  exp?: number;
  iat?: number;
}

function decodificarBase64Url(segmento: string): string {
  const base64 = segmento.replace(/-/g, '+').replace(/_/g, '/');
  const relleno = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binario = atob(relleno);
  const bytes = Uint8Array.from(binario, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Devuelve el payload, o null si no tiene forma de JWT (3 partes, JSON válido). */
export function decodeJwt(token: string): JwtPayload | null {
  const partes = token.split('.');
  if (partes.length !== 3 || partes.some((p) => p === '')) return null;
  try {
    const payload = JSON.parse(decodificarBase64Url(partes[1]));
    return payload && typeof payload === 'object' ? (payload as JwtPayload) : null;
  } catch {
    return null;
  }
}

/** Momento de vencimiento en milisegundos (Date.now()), o null si el token no trae `exp`. */
export function expiracionMs(token: string): number | null {
  const exp = decodeJwt(token)?.exp;
  return typeof exp === 'number' ? exp * 1000 : null;
}

/** Milisegundos que le quedan al token (negativo si ya venció). null si no trae `exp`. */
export function msParaExpirar(token: string): number | null {
  const venceEn = expiracionMs(token);
  return venceEn === null ? null : venceEn - Date.now();
}