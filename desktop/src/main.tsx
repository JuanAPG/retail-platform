import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import './styles.css';

// HashRouter (no BrowserRouter) porque la app se carga desde file://
// cuando está empaquetada por Electron; BrowserRouter necesita un servidor
// HTTP real detrás para resolver rutas al recargar.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);