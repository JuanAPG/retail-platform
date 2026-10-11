import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  fallo: boolean;
}

/**
 * Última red de seguridad: un error de render en un panel no debe dejar la
 * pantalla en blanco. Los errores de red NO llegan aquí (los atrapa cada
 * petición); esto cubre bugs de código y datos con una forma inesperada.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { fallo: false };

  static getDerivedStateFromError(): State {
    return { fallo: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Error de render', error, info.componentStack);
  }

  render() {
    if (!this.state.fallo) return this.props.children;
    return (
      <div role="alert" className="flex min-h-screen flex-col items-center justify-center gap-4 bg-marfil px-6 text-center">
        <p className="font-display text-3xl text-vino">Algo salió mal en esta pantalla</p>
        <p className="max-w-md text-sm text-teal/80">
          Es un error de la aplicación, no de tu conexión. Recarga la página; si se repite, avisa al equipo.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-full bg-teal px-6 py-3 text-sm font-bold text-arena hover:bg-vino"
        >
          Recargar
        </button>
      </div>
    );
  }
}
