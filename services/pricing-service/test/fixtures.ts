import { Client } from 'pg';

export interface PresentacionPropia {
  presentacion_id: string;
  producto_id: string;
  tienda_id: string;
  zona_id: string;
}

/**
 * PRI-13: cada suite crea SUS presentaciones en vez de buscar "una libre" en la base. Así no depende de qué
 * datos haya (ni de que otra suite o una corrida anterior ya haya puesto precios en ellas) y se puede correr
 * dos veces seguidas. Cuelgan de un producto activo existente (del proveedor indicado, si se pide) y se borran al final.
 *
 * Usa SQL directo porque es el andamiaje de la prueba, no el comportamiento que se prueba: catalog-service es de otro dueño.
 */
export async function crearPresentaciones(
  db: Client,
  etiqueta: string,
  cantidad: number,
  opciones: { emailProveedor?: string } = {},
): Promise<PresentacionPropia[]> {
  const producto = opciones.emailProveedor
    ? await db.query(
        `SELECT prod.id FROM productos prod JOIN proveedores pr ON pr.id = prod.proveedor_id
         WHERE prod.estatus = 'activo' AND pr.email = $1 ORDER BY prod.id LIMIT 1`,
        [opciones.emailProveedor],
      )
    : await db.query(`SELECT id FROM productos WHERE estatus = 'activo' ORDER BY id LIMIT 1`);
  const productoId: string = producto.rows[0].id;
  const unidad = (await db.query('SELECT id FROM unidades_medida ORDER BY id LIMIT 1')).rows[0].id;
  const tienda = (await db.query('SELECT id, zona_id FROM tiendas ORDER BY id LIMIT 1')).rows[0];

  const creadas: PresentacionPropia[] = [];
  for (let i = 0; i < cantidad; i++) {
    const { rows } = await db.query(
      `INSERT INTO producto_presentaciones (producto_id, nombre, contenido, unidad_medida_id)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [productoId, `IT ${etiqueta} ${Date.now()}-${i}`, 7 + i, unidad],
    );
    creadas.push({ presentacion_id: rows[0].id, producto_id: productoId, tienda_id: tienda.id, zona_id: tienda.zona_id });
  }
  return creadas;
}

/** Borra lo que cuelga de las presentaciones de prueba y luego las presentaciones. */
export async function borrarPresentaciones(db: Client, presentaciones: PresentacionPropia[]): Promise<void> {
  const ids = presentaciones.map((p) => p.presentacion_id);
  if (ids.length === 0) return;
  await db.query('DELETE FROM precios_observados WHERE presentacion_id = ANY($1::uuid[])', [ids]);
  await db.query('DELETE FROM precios_propuestos_proveedor WHERE presentacion_id = ANY($1::uuid[])', [ids]);
  await db.query('DELETE FROM precios WHERE presentacion_id = ANY($1::uuid[])', [ids]);
  await db.query('DELETE FROM producto_presentaciones WHERE id = ANY($1::uuid[])', [ids]);
}
