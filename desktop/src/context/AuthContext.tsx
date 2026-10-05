import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import axios from 'axios';
import * as authApi from '../api/authApi';
import { setAuthToken, setRefreshHandler } from '../api/httpClient';
import { decodeJwt, expiracionMs, msParaExpirar } from '../utils/jwt';

export interface SesionUsuario {
  nombre: string;
  email: string;
  rol: string;
  rolId: number;
}

interface StoredSession {
  accessToken: string;
  refreshToken: string;
  usuario: SesionUsuario;
}

interface AuthContextValue {
  isLoggedIn: boolean;
  isLoading: boolean;
  usuario: SesionUsuario | null;
  /** Momento (ms) en que vence el access token actual; null sin sesión. */
  expiraEn: number | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/** El access token se renueva un minuto ANTES de vencer (dura 15 min). */
const MARGEN_RENOVACION_MS = 60_000;

/**
 * auth-service ROTA el refresh token: si dos renovaciones corrieran a la vez, la
 * segunda usaría un refresh ya invalidado. Por eso comparten esta única promesa.
 */
let renovacionEnCurso: Promise<boolean> | null = null;

/** Error sin respuesta del servidor (apagado, sin red): ahí NO se debe cerrar la sesión. */
function esErrorDeRed(e: unknown): boolean {
  return axios.isAxiosError(e) && !e.response;
}

async function readStoredSession(): Promise<StoredSession | null> {
  const raw = await window.electronAPI.getSession();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (!parsed.accessToken || !parsed.refreshToken || !parsed.usuario) return null;
    return parsed as StoredSession;
  } catch {
    return null;
  }
}

async function persistSession(session: StoredSession) {
  await window.electronAPI.saveSession(JSON.stringify(session));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [usuario, setUsuario] = useState<SesionUsuario | null>(null);
  const [expiraEn, setExpiraEn] = useState<number | null>(null);

  const limpiarSesion = useCallback(async () => {
    setAuthToken(null);
    await window.electronAPI.clearSession();
    setUsuario(null);
    setExpiraEn(null);
    setIsLoggedIn(false);
  }, []);

  const renovarSesion = useCallback((): Promise<boolean> => {
    if (renovacionEnCurso) return renovacionEnCurso;
    renovacionEnCurso = (async () => {
      const stored = await readStoredSession();
      if (!stored) {
        await limpiarSesion();
        return false;
      }
      try {
        const result = await authApi.refresh(stored.refreshToken);
        setAuthToken(result.accessToken);
        await persistSession({ ...stored, accessToken: result.accessToken, refreshToken: result.refreshToken });
        setExpiraEn(expiracionMs(result.accessToken));
        return true;
      } catch (e) {
        if (esErrorDeRed(e)) return false;
        await limpiarSesion();
        return false;
      }
    })().finally(() => {
      renovacionEnCurso = null;
    });
    return renovacionEnCurso;
  }, [limpiarSesion]);

  // httpClient llama a esto solo cuando una petición recibe 401.
  useEffect(() => {
    setRefreshHandler(renovarSesion);
  }, [renovarSesion]);

  // Al abrir la app: se recupera la sesión guardada, pero revisándola antes de confiar en ella.
  useEffect(() => {
    let cancelado = false;

    async function restaurar() {
      const stored = await readStoredSession();
      if (!stored) return;

      // 1) Forma: ambos tokens deben ser JWT legibles.
      const payload = decodeJwt(stored.accessToken);
      const payloadRefresh = decodeJwt(stored.refreshToken);
      if (!payload || !payloadRefresh) return limpiarSesion();

      // 2) El rol guardado debe coincidir con el que dice el token (el menú depende de él).
      if (payload.rol && payload.rol !== stored.usuario.rol) return limpiarSesion();

      // 3) Si el refresh token ya venció, no hay forma de recuperar la sesión.
      const msRefresh = msParaExpirar(stored.refreshToken);
      if (msRefresh !== null && msRefresh <= 0) return limpiarSesion();

      setAuthToken(stored.accessToken);
      setUsuario(stored.usuario);
      setExpiraEn(expiracionMs(stored.accessToken));
      setIsLoggedIn(true);

      // 4) Vencido (o a punto): se renueva ya.
      const msAccess = msParaExpirar(stored.accessToken);
      if (msAccess !== null && msAccess <= MARGEN_RENOVACION_MS) {
        await renovarSesion();
        return;
      }

      // 5) Vigente por fecha: se confirma con auth-service que la sesión siga viva.
      try {
        const { active } = await authApi.validateToken(stored.accessToken);
        if (!active) await renovarSesion();
      } catch (e) {
        if (!esErrorDeRed(e)) await limpiarSesion();
      }
    }

    restaurar()
      .catch(() => limpiarSesion())
      .finally(() => {
        if (!cancelado) setIsLoading(false);
      });

    return () => {
      cancelado = true;
    };
  }, [limpiarSesion, renovarSesion]);

  // Renovación automática: un minuto antes de que venza el access token.
  useEffect(() => {
    if (expiraEn === null) return;
    const espera = Math.max(expiraEn - Date.now() - MARGEN_RENOVACION_MS, 0);
    const temporizador = setTimeout(() => {
      renovarSesion();
    }, espera);
    return () => clearTimeout(temporizador);
  }, [expiraEn, renovarSesion]);

  async function login(email: string, password: string) {
    const result = await authApi.login(email, password);
    const sesionUsuario: SesionUsuario = {
      nombre: result.usuario.nombre,
      email: result.usuario.email,
      rol: result.usuario.rol,
      rolId: result.usuario.rolId,
    };
    setAuthToken(result.accessToken);
    await persistSession({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      usuario: sesionUsuario,
    });
    setUsuario(sesionUsuario);
    setExpiraEn(expiracionMs(result.accessToken));
    setIsLoggedIn(true);
  }

  async function logout() {
    try {
      await authApi.logout();
    } finally {
      await limpiarSesion();
    }
  }

  return (
    <AuthContext.Provider value={{ isLoggedIn, isLoading, usuario, expiraEn, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}