import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { login as loginRequest, me as meRequest } from '../api/auth';
import { guardarSesion, guardarUsuario, leerToken, limpiarSesion } from '../api/client';
import { AuthUser } from '../types';

interface AuthContextValue {
  usuario: AuthUser | null;
  isAuthenticated: boolean;
  /** True mientras se revalida la sesión guardada al abrir la app. */
  cargandoSesion: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Se arranca con lo que haya en localStorage solo como valor optimista:
  // la verdad la define el GET /auth/me del efecto de abajo.
  const [usuario, setUsuario] = useState<AuthUser | null>(null);
  const [cargandoSesion, setCargandoSesion] = useState(true);

  useEffect(() => {
    const token = leerToken();

    // Sin token no hay sesión posible. Se limpia por si quedó un
    // `usuario` suelto en localStorage: con usuario pero sin token la
    // app daba por buena la sesión y luego CADA petición rebotaba con
    // 401 en un ciclo de redirecciones.
    if (!token) {
      limpiarSesion();
      setCargandoSesion(false);
      return;
    }

    let cancelado = false;

    meRequest()
      .then((usuarioVigente) => {
        if (cancelado) return;
        setUsuario(usuarioVigente);
        guardarUsuario(usuarioVigente);
      })
      .catch(() => {
        // Token expirado, secreto rotado o usuario desactivado por el
        // Administrador: la sesión ya no sirve.
        if (cancelado) return;
        limpiarSesion();
        setUsuario(null);
      })
      .finally(() => {
        if (!cancelado) setCargandoSesion(false);
      });

    return () => {
      cancelado = true;
    };
  }, []);

  async function login(email: string, password: string) {
    const { accessToken, refreshToken, usuario: usuarioAutenticado } = await loginRequest(
      email,
      password,
    );
    guardarSesion(accessToken, refreshToken, usuarioAutenticado);
    setUsuario(usuarioAutenticado);
    return usuarioAutenticado;
  }

  function logout() {
    limpiarSesion();
    setUsuario(null);
  }

  return (
    <AuthContext.Provider
      value={{
        usuario,
        isAuthenticated: !!usuario,
        cargandoSesion,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
