import { Link } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { menuParaRol } from '../config/menu';
import { ICONO_SECCION } from '../components/Layout';

/** Inicio: saludo y accesos a las secciones que el rol puede usar. */
export default function Home() {
  const { usuario } = useAuth();
  const items = menuParaRol(usuario?.rol ?? null);

  return (
    <div>
      <h1>Hola, {usuario?.nombre}</h1>
      <p className="muted">Estas son las secciones disponibles para tu perfil.</p>
      <div className="cards">
        {items.map((item) => {
          const Icono = ICONO_SECCION[item.path] ?? FileText;
          return (
            <Link key={item.path} to={item.path} className="card">
              <span className="card-icono" aria-hidden="true">
                <Icono size={20} />
              </span>
              <h3>{item.label}</h3>
              <p>{item.description}</p>
              <span className="servicio">{item.servicio}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
