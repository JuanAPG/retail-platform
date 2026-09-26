import { ReactNode } from 'react';
import type { NivelPermiso } from '../components/Sidebar';
import { RolNombre } from '../types';
import {
  IconAccesibilidad,
  IconAprobaciones,
  IconAsociacion,
  IconAuditoria,
  IconCanastas,
  IconElasticidad,
  IconHistorial,
  IconPerfil,
  IconPrecios,
  IconProductos,
  IconProponer,
  IconProveedores,
  IconRecomendaciones,
  IconReportes,
  IconResultados,
  IconSegmentos,
  IconSimulacion,
  IconTiendas,
  IconTransacciones,
  IconUsuarios,
  IconZonas,
} from '../components/ui/icons';

/**
 * Matriz de permisos por rol (DESIGN.md §4/§6): de aquí sale el menú del
 * Rail en cada portal. Un módulo que no aparece aquí para un rol, no se
 * muestra — nunca se oculta con CSS.
 *
 * Define QUÉ módulos existen por rol y su ícono/permiso; cada portal, al
 * redisañarse, decide `active`/`onClick`/`badge` según su propio estado
 * de tabs y arma la lista de `RailModule` combinando esto con eso.
 */
export interface ModuloDefinicion {
  key: string;
  label: string;
  icon: ReactNode;
  permiso?: NivelPermiso;
}

export const MODULOS_POR_ROL: Record<RolNombre, ModuloDefinicion[]> = {
  Administrador: [
    { key: 'usuarios', label: 'Usuarios', icon: <IconUsuarios /> },
    { key: 'tiendas', label: 'Tiendas', icon: <IconTiendas /> },
    { key: 'zonas', label: 'Zonas', icon: <IconZonas /> },
    { key: 'proveedores', label: 'Proveedores', icon: <IconProveedores /> },
    { key: 'auditoria', label: 'Auditoría', icon: <IconAuditoria />, permiso: 'lectura' },
  ],
  'Gerente de categoría': [
    { key: 'catalogo-productos', label: 'Catálogo de productos', icon: <IconProductos /> },
    { key: 'aprobaciones', label: 'Aprobaciones', icon: <IconAprobaciones />, permiso: 'aprueba' },
    { key: 'comparar-precios', label: 'Comparar precios', icon: <IconPrecios />, permiso: 'lectura' },
    { key: 'reportes', label: 'Reportes', icon: <IconReportes />, permiso: 'lectura' },
    { key: 'tiendas', label: 'Tiendas', icon: <IconTiendas />, permiso: 'lectura' },
    { key: 'proveedores', label: 'Proveedores', icon: <IconProveedores />, permiso: 'lectura' },
  ],
  'Responsable de precios': [
    { key: 'gestion-precios', label: 'Gestión de precios', icon: <IconPrecios /> },
    { key: 'aprobaciones-precio', label: 'Aprobaciones', icon: <IconAprobaciones />, permiso: 'aprueba' },
    { key: 'elasticidad', label: 'Elasticidad', icon: <IconElasticidad /> },
    { key: 'productos', label: 'Productos', icon: <IconProductos />, permiso: 'lectura' },
    { key: 'tiendas', label: 'Tiendas', icon: <IconTiendas />, permiso: 'lectura' },
    { key: 'reportes-precios', label: 'Reportes', icon: <IconReportes />, permiso: 'lectura' },
  ],
  Proveedor: [
    { key: 'mis-productos', label: 'Mis productos', icon: <IconProductos /> },
    { key: 'proponer-alta', label: 'Proponer alta', icon: <IconProponer />, permiso: 'propone' },
    { key: 'mis-solicitudes', label: 'Mis solicitudes', icon: <IconHistorial /> },
    { key: 'cambio-precio', label: 'Cambio de precio', icon: <IconPrecios />, permiso: 'propone' },
    { key: 'mi-perfil', label: 'Mi perfil', icon: <IconPerfil /> },
  ],
  'Analista comercial': [
    { key: 'transacciones', label: 'Transacciones', icon: <IconTransacciones /> },
    { key: 'segmentos', label: 'Segmentos de ingreso', icon: <IconSegmentos /> },
    { key: 'canastas', label: 'Canastas', icon: <IconCanastas /> },
    { key: 'reglas-asociacion', label: 'Reglas de asociación', icon: <IconAsociacion /> },
    { key: 'accesibilidad', label: 'Accesibilidad', icon: <IconAccesibilidad /> },
    { key: 'productos', label: 'Productos', icon: <IconProductos />, permiso: 'lectura' },
    { key: 'tiendas', label: 'Tiendas', icon: <IconTiendas />, permiso: 'lectura' },
  ],
  Planeador: [
    { key: 'nueva-simulacion', label: 'Nueva simulación', icon: <IconSimulacion /> },
    { key: 'historial-simulaciones', label: 'Historial', icon: <IconHistorial /> },
    { key: 'resultados', label: 'Resultados', icon: <IconResultados /> },
    { key: 'recomendaciones', label: 'Recomendaciones', icon: <IconRecomendaciones /> },
    { key: 'productos', label: 'Productos', icon: <IconProductos />, permiso: 'lectura' },
    { key: 'tiendas', label: 'Tiendas', icon: <IconTiendas />, permiso: 'lectura' },
    { key: 'precios', label: 'Precios', icon: <IconPrecios />, permiso: 'lectura' },
    { key: 'transacciones', label: 'Transacciones', icon: <IconTransacciones />, permiso: 'lectura' },
  ],
  Auditor: [
    { key: 'bitacora', label: 'Bitácora de auditoría', icon: <IconAuditoria /> },
    { key: 'usuarios', label: 'Usuarios', icon: <IconUsuarios />, permiso: 'lectura' },
    { key: 'tiendas', label: 'Tiendas', icon: <IconTiendas />, permiso: 'lectura' },
    { key: 'zonas', label: 'Zonas', icon: <IconZonas />, permiso: 'lectura' },
    { key: 'proveedores', label: 'Proveedores', icon: <IconProveedores />, permiso: 'lectura' },
    { key: 'productos', label: 'Productos', icon: <IconProductos />, permiso: 'lectura' },
    { key: 'precios', label: 'Precios', icon: <IconPrecios />, permiso: 'lectura' },
    { key: 'transacciones', label: 'Transacciones', icon: <IconTransacciones />, permiso: 'lectura' },
  ],
};
