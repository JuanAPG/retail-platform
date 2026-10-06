import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { menuParaRol } from '../config/menu';

/** Inicio: saludo y accesos a las secciones que el rol puede usar. */
export default function Home() {
  const { usuario } = useAuth();
  const items = menuParaRol(usuario?.rol ?? null);

  return (
    <div>
      <h1>Hola, {usuario?.nombre}</h1>
      <p className="muted">Estas son las secciones disponibles para tu perfil.</p>
      <div className="cards">
        {items.map((item) => (
          <Link key={item.path} to={item.path} className="card">
            <h3>{item.label}</h3>
            <p>{item.description}</p>
            <span className="muted">{item.servicio}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}