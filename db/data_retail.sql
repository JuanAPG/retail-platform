-- =====================================================================
-- data_retail.sql — datos de prueba para el esquema v3.
--
-- Requiere que schema.sql ya se haya ejecutado.
--
-- Todas las inserciones usan llaves naturales (nombre, email, sku) en vez
-- de UUID fijos, y llevan ON CONFLICT DO NOTHING o un guardia NOT EXISTS:
-- el archivo se puede volver a ejecutar sin duplicar nada.
--
-- Contraseña de prueba para TODOS los usuarios: Passw0rd123!
-- (hash bcrypt real, costo 12)
-- =====================================================================

BEGIN;

-- --------------------------------------------------------------- 1. ROLES
INSERT INTO roles (nombre, descripcion) VALUES
    ('Administrador',         'Gestiona usuarios, perfiles y configuración general del sistema.'),
    ('Analista comercial',    'Integra transacciones, construye canastas y ejecuta el análisis descriptivo y de asociación.'),
    ('Gerente de categoría',  'Gestiona el catálogo de productos y compara precios entre zonas.'),
    ('Responsable de precios','Gestiona precios del catálogo y calcula la elasticidad precio-demanda.'),
    ('Planeador',             'Diseña y ejecuta simulaciones de formatos, empaques y descuentos.'),
    ('Auditor',               'Consulta bitácoras de auditoría y valida el cumplimiento de reglas.'),
    ('Proveedor',             'Usuario externo que propone sus propios productos al catálogo.')
ON CONFLICT (nombre) DO NOTHING;

-- --------------------------------------------------------------- 2. MÓDULOS
INSERT INTO modulos (clave, nombre, descripcion) VALUES
    ('M01','Usuarios y acceso',      'Autenticación, roles y CRUD de cuentas.'),
    ('M02','Tiendas',                'Catálogo de tiendas y sucursales.'),
    ('M03','Zonas',                  'Zonas geográficas y su clasificación.'),
    ('M04','Productos',              'Catálogo de productos y presentaciones.'),
    ('M05','Segmentos de ingreso',   'Clasificación de zonas por nivel de ingreso.'),
    ('M06','Transacciones',          'Carga e importación de transacciones por CSV.'),
    ('M07','Canastas',               'Construcción de canastas de consumo.'),
    ('M08','Precios',                'Precios vigentes e histórico.'),
    ('M09','Analítica descriptiva',  'Indicadores de tamaño y frecuencia de compra.'),
    ('M10','Asociación',             'Reglas de asociación (Apriori / FP-Growth).'),
    ('M11','Elasticidad',            'Elasticidad precio-demanda y sustitución.'),
    ('M12','Accesibilidad',          'Índice de accesibilidad por zona.'),
    ('M13','Simulación',             'Escenarios y simulación de impacto.'),
    ('M14','Recomendaciones',        'Motor de reglas de recomendación.'),
    ('M15','Auditoría',              'Bitácora inmutable de operaciones.')
ON CONFLICT (clave) DO NOTHING;

-- --------------------------------------------------------------- 3. USUARIOS
INSERT INTO usuarios (nombre, email, password_hash, rol_id, activo)
SELECT v.nombre, v.email, v.password_hash, r.id, v.activo
FROM (VALUES
    ('María López Herrera',  'admin@retail.mx',           '$2b$12$6Lzfua0Zj9Fq/CrxvRq3eecqyrxGJQkvioIN7795JngPXI3aPvWXi', 'Administrador',          TRUE),
    ('Carlos Ruiz Torres',   'analista@retail.mx',        '$2b$12$6Lzfua0Zj9Fq/CrxvRq3eecqyrxGJQkvioIN7795JngPXI3aPvWXi', 'Analista comercial',     TRUE),
    ('Roberto Méndez Silva', 'gercategoria@retail.mx',    '$2b$12$6Lzfua0Zj9Fq/CrxvRq3eecqyrxGJQkvioIN7795JngPXI3aPvWXi', 'Gerente de categoría',   TRUE),
    ('Laura Vega Campos',    'precios@retail.mx',         '$2b$12$6Lzfua0Zj9Fq/CrxvRq3eecqyrxGJQkvioIN7795JngPXI3aPvWXi', 'Responsable de precios', TRUE),
    ('Jorge Soto Ramos',     'planeador@retail.mx',       '$2b$12$6Lzfua0Zj9Fq/CrxvRq3eecqyrxGJQkvioIN7795JngPXI3aPvWXi', 'Planeador',              TRUE),
    ('Ana Torres Medina',    'auditor@retail.mx',         '$2b$12$6Lzfua0Zj9Fq/CrxvRq3eecqyrxGJQkvioIN7795JngPXI3aPvWXi', 'Auditor',                TRUE),
    ('Elena Ruiz Domínguez', 'contacto@bioorganicos.mx',  '$2b$12$6Lzfua0Zj9Fq/CrxvRq3eecqyrxGJQkvioIN7795JngPXI3aPvWXi', 'Proveedor',              TRUE),
    ('Hugo Cantú Salinas',   'ventas@lacteosdelnorte.mx', '$2b$12$6Lzfua0Zj9Fq/CrxvRq3eecqyrxGJQkvioIN7795JngPXI3aPvWXi', 'Proveedor',              TRUE)
) AS v(nombre, email, password_hash, rol_nombre, activo)
JOIN roles r ON r.nombre = v.rol_nombre
ON CONFLICT (email) DO NOTHING;

-- --------------------------------------------------------------- 4. PROVEEDORES
INSERT INTO proveedores (razon_social, rfc, contacto_nombre, email, telefono, activo) VALUES
    ('BioOrgánicos S.A.P.I. de C.V.', 'BOR210615AB3', 'Elena Ruiz Domínguez', 'contacto@bioorganicos.mx',  '81 1234 5678', TRUE),
    ('Lácteos del Norte S.A. de C.V.','LNO180903KZ9', 'Hugo Cantú Salinas',   'ventas@lacteosdelnorte.mx', '81 8765 4321', TRUE)
ON CONFLICT (email) DO NOTHING;

-- --------------------------------------------------------------- 5. TERRITORIO
INSERT INTO municipios (nombre) VALUES
    ('San Pedro Garza García'), ('Monterrey'), ('Guadalupe')
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO segmentos_ingreso (nombre, ingreso_min, ingreso_max, descripcion) VALUES
    ('Ingreso bajo',  0.00,      15000.00, 'Hogares por debajo de la mediana metropolitana.'),
    ('Ingreso medio', 15000.01,  45000.00, 'Hogares alrededor de la mediana metropolitana.'),
    ('Ingreso alto',  45000.01,  NULL,     'Hogares por encima del tercer cuartil.')
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO zonas (nombre, municipio_id, descripcion, activo)
SELECT v.nombre, m.id, v.descripcion, TRUE
FROM (VALUES
    ('Zona Valle',      'San Pedro Garza García', 'Corredor comercial de alto poder adquisitivo.'),
    ('Zona Centro',     'Monterrey',              'Centro histórico y comercio tradicional.'),
    ('Zona Oriente',    'Guadalupe',              'Colonias habitacionales de ingreso medio-bajo.')
) AS v(nombre, municipio_nombre, descripcion)
JOIN municipios m ON m.nombre = v.municipio_nombre
ON CONFLICT (nombre, municipio_id) DO NOTHING;

-- Clasificación de cada zona (asignación manual: corrida_id NULL).
INSERT INTO zona_clasificaciones (zona_id, segmento_ingreso_id, asignada_por, vigente)
SELECT z.id, s.id, u.id, TRUE
FROM (VALUES
    ('Zona Valle',   'Ingreso alto'),
    ('Zona Centro',  'Ingreso medio'),
    ('Zona Oriente', 'Ingreso bajo')
) AS v(zona, segmento)
JOIN zonas z ON z.nombre = v.zona
JOIN segmentos_ingreso s ON s.nombre = v.segmento
CROSS JOIN usuarios u
WHERE u.email = 'admin@retail.mx'
  AND NOT EXISTS (
      SELECT 1 FROM zona_clasificaciones zc WHERE zc.zona_id = z.id AND zc.vigente
  );

-- --------------------------------------------------------------- 6. TIENDAS
INSERT INTO direcciones (calle, numero_exterior, colonia, codigo_postal, municipio_id)
SELECT v.calle, v.num, v.colonia, v.cp, m.id
FROM (VALUES
    ('Av. Vasconcelos',   '402',  'Del Valle',       '66220', 'San Pedro Garza García'),
    ('Av. Constitución',  '1050', 'Centro',          '64000', 'Monterrey'),
    ('Av. Pablo Livas',   '2300', 'Nueva Linda Vista','67130', 'Guadalupe')
) AS v(calle, num, colonia, cp, municipio_nombre)
JOIN municipios m ON m.nombre = v.municipio_nombre
WHERE NOT EXISTS (
    SELECT 1 FROM direcciones d WHERE d.calle = v.calle AND d.numero_exterior = v.num
);

INSERT INTO tiendas (nombre, direccion_id, zona_id, formato, numero_sucursal, activo)
SELECT v.nombre, d.id, z.id, v.formato::formato_tienda, v.sucursal, TRUE
FROM (VALUES
    ('Super Valle Centro',   'Av. Vasconcelos',  'Zona Valle',   'supermercado',        'SUC-001'),
    ('Abarrotes Constitución','Av. Constitución', 'Zona Centro',  'minimarket',          'SUC-002'),
    ('Mercado Pablo Livas',  'Av. Pablo Livas',  'Zona Oriente', 'tienda_conveniencia', 'SUC-003')
) AS v(nombre, calle, zona, formato, sucursal)
JOIN direcciones d ON d.calle = v.calle
JOIN zonas z ON z.nombre = v.zona
WHERE NOT EXISTS (SELECT 1 FROM tiendas t WHERE t.nombre = v.nombre);

-- Solo una de las tres tiene sitio propio: la ausencia de fila es el "no".
INSERT INTO tienda_canal_web (tienda_id, url, gestion_datos, integrada)
SELECT t.id, 'https://supervalle.mx', 'Catálogo propio en WooCommerce; exporta ventas a CSV diario.', FALSE
FROM tiendas t
WHERE t.nombre = 'Super Valle Centro'
  AND NOT EXISTS (SELECT 1 FROM tienda_canal_web w WHERE w.tienda_id = t.id);

-- --------------------------------------------------------------- 7. CATÁLOGO
INSERT INTO unidades_medida (clave, nombre, tipo, factor_base) VALUES
    ('kg',  'Kilogramo', 'masa',    1.0),
    ('g',   'Gramo',     'masa',    0.001),
    ('l',   'Litro',     'volumen', 1.0),
    ('ml',  'Mililitro', 'volumen', 0.001),
    ('pza', 'Pieza',     'pieza',   1.0)
ON CONFLICT (clave) DO NOTHING;

INSERT INTO categorias_producto (nombre, descripcion) VALUES
    ('Abarrotes', 'Granos, semillas y cereales.'),
    ('Lácteos',   'Leche, quesos, yogures y derivados.'),
    ('Bebidas',   'Bebidas no alcohólicas envasadas.')
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO productos (sku, nombre, descripcion, categoria_id, es_canasta_basica, estatus, proveedor_id)
SELECT v.sku, v.nombre, v.descripcion, c.id, v.basico, v.estatus::estatus_producto,
       (SELECT p.id FROM proveedores p WHERE p.email = v.proveedor_email)
FROM (VALUES
    ('P-001-001',   'Frijol negro',        'Frijol negro a granel.',                'Abarrotes', TRUE,  'activo',               NULL::VARCHAR),
    ('BIO-QUI-500', 'Quinoa orgánica',     'Quinoa blanca orgánica certificada.',   'Abarrotes', FALSE, 'activo',               'contacto@bioorganicos.mx'),
    ('BIO-AMA-300', 'Amaranto inflado',    'Amaranto inflado sin azúcar añadida.',  'Abarrotes', FALSE, 'pendiente_aprobacion', 'contacto@bioorganicos.mx'),
    ('LDN-LEC',     'Leche entera',        'Leche entera pasteurizada.',            'Lácteos',   TRUE,  'activo',               'ventas@lacteosdelnorte.mx'),
    ('LDN-YOG-900', 'Yogur natural',       'Yogur natural sin azúcar.',             'Lácteos',   FALSE, 'pendiente_aprobacion', 'ventas@lacteosdelnorte.mx'),
    ('LDN-QUE-400', 'Queso panela',        'Queso panela fresco.',                  'Lácteos',   FALSE, 'activo',               'ventas@lacteosdelnorte.mx')
) AS v(sku, nombre, descripcion, categoria_nombre, basico, estatus, proveedor_email)
JOIN categorias_producto c ON c.nombre = v.categoria_nombre
ON CONFLICT (sku) DO NOTHING;

-- RF-35: varias presentaciones por producto. El frijol y la leche tienen
-- dos cada uno, para que se note que el precio va por presentación.
INSERT INTO producto_presentaciones (producto_id, nombre, contenido, unidad_medida_id, es_predeterminada, activo)
SELECT p.id, v.nombre, v.contenido, u.id, v.predeterminada, TRUE
FROM (VALUES
    ('P-001-001',   '1 kg',    1.000,  'kg',  TRUE),
    ('P-001-001',   '500 g',   500.000,'g',   FALSE),
    ('BIO-QUI-500', '500 g',   500.000,'g',   TRUE),
    ('BIO-AMA-300', '300 g',   300.000,'g',   TRUE),
    ('LDN-LEC',     '1 L',     1.000,  'l',   TRUE),
    ('LDN-LEC',     '250 ml',  250.000,'ml',  FALSE),
    ('LDN-YOG-900', '900 g',   900.000,'g',   TRUE),
    ('LDN-QUE-400', '400 g',   400.000,'g',   TRUE)
) AS v(sku, nombre, contenido, unidad, predeterminada)
JOIN productos p ON p.sku = v.sku
JOIN unidades_medida u ON u.clave = v.unidad
ON CONFLICT (producto_id, nombre) DO NOTHING;

-- Los productos ya activos pasaron por una revisión: se registra.
INSERT INTO producto_revisiones (producto_id, estatus_resultante, revisado_por, motivo)
SELECT p.id, 'activo'::estatus_producto, u.id, NULL
FROM productos p
CROSS JOIN usuarios u
WHERE p.estatus = 'activo'
  AND u.email = 'gercategoria@retail.mx'
  AND NOT EXISTS (SELECT 1 FROM producto_revisiones r WHERE r.producto_id = p.id);

-- --------------------------------------------------------------- 8. PRECIOS E INVENTARIO
INSERT INTO precios (presentacion_id, tienda_id, precio, fecha_vigencia_desde, vigente, origen, creado_por)
SELECT pp.id, t.id, v.precio, v.desde::date, v.vigente, 'interno'::origen_precio, u.id
FROM (VALUES
    ('P-001-001',  '1 kg',  'Super Valle Centro',     38.00, '2026-06-01', FALSE),
    ('P-001-001',  '1 kg',  'Super Valle Centro',     42.50, '2026-08-01', TRUE),
    ('P-001-001',  '1 kg',  'Mercado Pablo Livas',    36.00, '2026-08-01', TRUE),
    ('P-001-001',  '500 g', 'Super Valle Centro',     24.00, '2026-08-01', TRUE),
    ('LDN-LEC',    '1 L',   'Super Valle Centro',     28.50, '2026-08-01', TRUE),
    ('LDN-LEC',    '1 L',   'Abarrotes Constitución', 27.00, '2026-08-01', TRUE),
    ('LDN-LEC',    '1 L',   'Mercado Pablo Livas',    26.00, '2026-08-01', TRUE),
    ('BIO-QUI-500','500 g', 'Super Valle Centro',     92.00, '2026-08-01', TRUE),
    ('LDN-QUE-400','400 g', 'Super Valle Centro',     58.00, '2026-08-01', TRUE),
    ('LDN-QUE-400','400 g', 'Abarrotes Constitución', 55.50, '2026-08-01', TRUE)
) AS v(sku, presentacion, tienda, precio, desde, vigente)
JOIN productos p ON p.sku = v.sku
JOIN producto_presentaciones pp ON pp.producto_id = p.id AND pp.nombre = v.presentacion
JOIN tiendas t ON t.nombre = v.tienda
CROSS JOIN usuarios u
WHERE u.email = 'precios@retail.mx'
  AND NOT EXISTS (
      SELECT 1 FROM precios pr
      WHERE pr.presentacion_id = pp.id AND pr.tienda_id = t.id
        AND pr.fecha_vigencia_desde = v.desde::date
  );

INSERT INTO inventario (tienda_id, presentacion_id, stock_disponible)
SELECT t.id, pp.id, v.stock
FROM (VALUES
    ('P-001-001',  '1 kg',  'Super Valle Centro',     120.00),
    ('P-001-001',  '1 kg',  'Mercado Pablo Livas',     45.00),
    ('P-001-001',  '500 g', 'Super Valle Centro',      80.00),
    ('LDN-LEC',    '1 L',   'Super Valle Centro',     200.00),
    ('LDN-LEC',    '1 L',   'Abarrotes Constitución',  60.00),
    ('LDN-LEC',    '1 L',   'Mercado Pablo Livas',      0.00),
    ('BIO-QUI-500','500 g', 'Super Valle Centro',      30.00),
    ('LDN-QUE-400','400 g', 'Super Valle Centro',      55.00),
    ('LDN-QUE-400','400 g', 'Abarrotes Constitución',  20.00)
) AS v(sku, presentacion, tienda, stock)
JOIN productos p ON p.sku = v.sku
JOIN producto_presentaciones pp ON pp.producto_id = p.id AND pp.nombre = v.presentacion
JOIN tiendas t ON t.nombre = v.tienda
ON CONFLICT (tienda_id, presentacion_id) DO NOTHING;

-- --------------------------------------------------------------- 9. INDICADORES
-- Catálogo. Agregar un indicador nuevo es insertar una fila aquí, no un
-- ALTER TABLE: eso es lo que se ganó al normalizar.
INSERT INTO indicadores (clave, nombre, descripcion, unidad, ambito, formula) VALUES
    ('ticket_promedio',        'Ticket promedio',           'Valor promedio de una canasta.',                             'MXN',         'global',   'sum(valor_total) / count(canastas)'),
    ('productos_por_canasta',  'Productos por canasta',     'Número promedio de productos distintos por canasta.',        'productos',   'global',   'sum(numero_productos) / count(canastas)'),
    ('unidades_por_transaccion','Unidades por transacción', 'Unidades promedio compradas por transacción.',               'unidades',    'global',   'sum(unidades_totales) / count(canastas)'),
    ('frecuencia_de_compra',   'Frecuencia de compra',      'Compras promedio por cliente en el periodo.',                'compras/mes', 'zona',     'count(canastas) / clientes_distintos / meses'),
    ('gasto_por_categoria',    'Gasto por categoría',       'Gasto acumulado en una categoría.',                          'MXN',         'categoria','sum(subtotal) agrupado por categoría'),
    ('ingreso_estimado',       'Ingreso estimado',          'Ingreso mensual estimado del hogar promedio de la zona.',    'MXN',         'zona',     'fuente censal, no calculado'),
    ('poblacion',              'Población',                 'Habitantes estimados de la zona.',                           'personas',    'zona',     'fuente censal, no calculado'),
    ('disponibilidad',         'Disponibilidad',            'Proporción de productos básicos con stock en la zona.',      '%',           'zona',     'básicos con stock / básicos totales'),
    ('indice_accesibilidad',   'Índice de accesibilidad',   'Índice compuesto de accesibilidad (indicador analítico).',   'índice 0-1',  'zona',     'ver accesibilidad_componentes'),
    ('demanda_estimada',       'Demanda estimada',          'Unidades estimadas de demanda en el escenario.',             'unidades',    'zona',     'modelo de simulación M13'),
    ('ingreso_estimado_venta', 'Ingreso estimado de venta', 'Ingreso estimado por ventas en el escenario.',               'MXN',         'zona',     'demanda x precio simulado')
ON CONFLICT (clave) DO NOTHING;

-- --------------------------------------------------------------- 10. TRANSACCIONES
-- Seis transacciones repartidas entre las tres zonas, para que el
-- dashboard tenga algo que mostrar desde el primer arranque.
INSERT INTO transacciones (folio, tienda_id, canal, fecha, total)
SELECT v.folio, t.id, 'punto_venta'::canal_transaccion, v.fecha::timestamptz, 0
FROM (VALUES
    ('T-0001', 'Super Valle Centro',     '2026-08-05 10:15:00-06'),
    ('T-0002', 'Super Valle Centro',     '2026-08-07 18:40:00-06'),
    ('T-0003', 'Abarrotes Constitución', '2026-08-06 09:05:00-06'),
    ('T-0004', 'Abarrotes Constitución', '2026-08-12 19:20:00-06'),
    ('T-0005', 'Mercado Pablo Livas',    '2026-08-08 08:30:00-06'),
    ('T-0006', 'Mercado Pablo Livas',    '2026-08-14 20:10:00-06')
) AS v(folio, tienda, fecha)
JOIN tiendas t ON t.nombre = v.tienda
ON CONFLICT (tienda_id, folio) DO NOTHING;

INSERT INTO transacciones_detalle (transaccion_id, presentacion_id, cantidad, precio_unitario)
SELECT tr.id, pp.id, v.cantidad, v.precio
FROM (VALUES
    ('T-0001', 'P-001-001',  '1 kg',  2.00, 42.50),
    ('T-0001', 'LDN-LEC',    '1 L',   3.00, 28.50),
    ('T-0001', 'BIO-QUI-500','500 g', 1.00, 92.00),
    ('T-0002', 'LDN-QUE-400','400 g', 2.00, 58.00),
    ('T-0002', 'LDN-LEC',    '1 L',   1.00, 28.50),
    ('T-0003', 'LDN-LEC',    '1 L',   2.00, 27.00),
    ('T-0003', 'LDN-QUE-400','400 g', 1.00, 55.50),
    ('T-0004', 'LDN-LEC',    '1 L',   4.00, 27.00),
    ('T-0005', 'P-001-001',  '1 kg',  1.00, 36.00),
    ('T-0006', 'P-001-001',  '1 kg',  3.00, 36.00)
) AS v(folio, sku, presentacion, cantidad, precio)
JOIN transacciones tr ON tr.folio = v.folio
JOIN productos p ON p.sku = v.sku
JOIN producto_presentaciones pp ON pp.producto_id = p.id AND pp.nombre = v.presentacion
ON CONFLICT (transaccion_id, presentacion_id) DO NOTHING;

-- El total del encabezado se recalcula desde el detalle: nunca se captura
-- a mano, para que no pueda contradecir a sus líneas.
UPDATE transacciones t
SET total = COALESCE((
    SELECT sum(d.subtotal) FROM transacciones_detalle d WHERE d.transaccion_id = t.id
), 0);

-- --------------------------------------------------------------- 11. CANASTAS
-- Una canasta por transacción, con la zona y el segmento congelados al
-- momento de construirla (RN-03, RN-05).
INSERT INTO canastas (transaccion_id, zona_id, segmento_ingreso_id, fecha,
                      valor_total, numero_productos, unidades_totales,
                      productos_basicos, tamano)
SELECT
    t.id,
    ti.zona_id,
    zc.segmento_ingreso_id,
    t.fecha,
    t.total,
    (SELECT count(*)          FROM transacciones_detalle d WHERE d.transaccion_id = t.id),
    (SELECT sum(d.cantidad)   FROM transacciones_detalle d WHERE d.transaccion_id = t.id),
    (SELECT count(*)
       FROM transacciones_detalle d
       JOIN producto_presentaciones pp ON pp.id = d.presentacion_id
       JOIN productos p ON p.id = pp.producto_id
      WHERE d.transaccion_id = t.id AND p.es_canasta_basica),
    CASE
        WHEN t.total < 80  THEN 'chica'
        WHEN t.total < 200 THEN 'mediana'
        ELSE 'grande'
    END::tamano_compra
FROM transacciones t
JOIN tiendas ti ON ti.id = t.tienda_id
LEFT JOIN zona_clasificaciones zc ON zc.zona_id = ti.zona_id AND zc.vigente
WHERE NOT EXISTS (SELECT 1 FROM canastas k WHERE k.transaccion_id = t.id);

COMMIT;
