-- =====================================================================
-- data_retail.sql
-- Datos de prueba mínimos para la Plataforma de Análisis de Ingreso
-- y Patrones de Consumo Minorista.
--
-- Requiere que schema.sql ya se haya ejecutado sobre la base de datos.
--
-- Contenido (1 registro por tipo, salvo donde se indica):
--   1. roles               -> los 7 roles del sistema
--   2. usuarios            -> 1 usuario por cada uno de los 7 roles
--   3. proveedores         -> 1 proveedor
--   4. tiendas             -> 1 tienda
--   5. municipios          -> 1 municipio
--   6. zonas               -> 1 zona
--   7. categorias_producto -> 1 categoría
--   8. productos           -> 1 producto
--
-- Todas las inserciones usan subconsultas (por nombre/email/sku) en
-- vez de UUIDs fijos, para no depender de que gen_random_uuid()
-- produzca un valor específico y para que el archivo sea reutilizable
-- sin editarlo aunque la base ya tenga otros datos.
--
-- Contraseña de prueba para TODOS los usuarios: Passw0rd123!
-- (hash bcrypt real, costo 12, generado para este archivo)
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. ROLES (los 7 roles definidos en S0_Matriz_de_Perfiles_y_Permisos)
-- ---------------------------------------------------------------------
INSERT INTO roles (nombre, descripcion) VALUES
    ('Administrador',         'Gestiona usuarios, perfiles y configuración general del sistema.'),
    ('Analista comercial',    'Integra transacciones, construye canastas de consumo, ejecuta reglas de asociación y calcula indicadores de accesibilidad.'),
    ('Gerente de categoría',  'Gestiona el catálogo de productos y compara precios entre zonas.'),
    ('Responsable de precios','Gestiona precios del catálogo y calcula la elasticidad precio-demanda.'),
    ('Planeador',             'Diseña y ejecuta simulaciones de formatos, empaques y descuentos.'),
    ('Auditor',               'Consulta bitácoras de auditoría y valida el cumplimiento de reglas del sistema.'),
    ('Proveedor',             'Usuario externo que da de alta sus propios productos para ofrecerlos a los negocios de la plataforma.')
ON CONFLICT (nombre) DO NOTHING;

-- ---------------------------------------------------------------------
-- 2. USUARIOS (1 por cada rol)
--    password_hash corresponde a "Passw0rd123!" (bcrypt, costo 12).
-- ---------------------------------------------------------------------
INSERT INTO usuarios (nombre, email, password_hash, rol_id, activo)
SELECT v.nombre, v.email, v.password_hash, r.id, v.activo
FROM (VALUES
    ('María López Herrera', 'admin@retail.mx',      '$2b$12$6Lzfua0Zj9Fq/CrxvRq3eecqyrxGJQkvioIN7795JngPXI3aPvWXi', 'Administrador',         TRUE),
    ('Carlos Ruiz Torres',  'analista@retail.mx',    '$2b$12$6Lzfua0Zj9Fq/CrxvRq3eecqyrxGJQkvioIN7795JngPXI3aPvWXi', 'Analista comercial',    TRUE),
    ('Roberto Méndez Silva','gercategoria@retail.mx','$2b$12$6Lzfua0Zj9Fq/CrxvRq3eecqyrxGJQkvioIN7795JngPXI3aPvWXi', 'Gerente de categoría',  TRUE),
    ('Laura Vega Campos',   'precios@retail.mx',     '$2b$12$6Lzfua0Zj9Fq/CrxvRq3eecqyrxGJQkvioIN7795JngPXI3aPvWXi', 'Responsable de precios',TRUE),
    ('Jorge Soto Ramos',    'planeador@retail.mx',   '$2b$12$6Lzfua0Zj9Fq/CrxvRq3eecqyrxGJQkvioIN7795JngPXI3aPvWXi', 'Planeador',             TRUE),
    ('Ana Torres Medina',   'auditor@retail.mx',     '$2b$12$6Lzfua0Zj9Fq/CrxvRq3eecqyrxGJQkvioIN7795JngPXI3aPvWXi', 'Auditor',               TRUE),
    ('Elena Ruiz Domínguez','contacto@bioorganicos.mx','$2b$12$6Lzfua0Zj9Fq/CrxvRq3eecqyrxGJQkvioIN7795JngPXI3aPvWXi', 'Proveedor',           TRUE)
) AS v(nombre, email, password_hash, rol_nombre, activo)
JOIN roles r ON r.nombre = v.rol_nombre
ON CONFLICT (email) DO NOTHING;

-- ---------------------------------------------------------------------
-- 3. PROVEEDORES (1)
--    email coincide a propósito con el usuario de rol 'Proveedor' de
--    arriba: es el mecanismo de vínculo usuario<->empresa descrito en
--    AuthService.registerProveedor() (usuarios ya no tiene FK directa
--    a proveedores desde el cambio de schema).
-- ---------------------------------------------------------------------
INSERT INTO proveedores (razon_social, rfc, contacto_nombre, email, telefono, activo)
VALUES (
    'BioOrgánicos S.A.P.I. de C.V.',
    'BOR210615AB3',
    'Elena Ruiz Domínguez',
    'contacto@bioorganicos.mx',
    '81 1234 5678',
    TRUE
)
ON CONFLICT (email) DO NOTHING;

-- ---------------------------------------------------------------------
-- 4. MUNICIPIOS (1)
-- ---------------------------------------------------------------------
INSERT INTO municipios (nombre) VALUES
    ('San Pedro Garza García')
ON CONFLICT (nombre) DO NOTHING;

-- ---------------------------------------------------------------------
-- 5. ZONAS (1)
--    segmento_ingreso_id y datos de clustering se dejan en NULL: la
--    tabla segmentos_ingreso no forma parte de este set de datos de
--    prueba (no se solicitó poblarla).
-- ---------------------------------------------------------------------
INSERT INTO zonas (nombre, municipio_id, activo)
SELECT 'Zona Valle', m.id, TRUE
FROM municipios m
WHERE m.nombre = 'San Pedro Garza García'
ON CONFLICT (nombre, municipio_id) DO NOTHING;

-- ---------------------------------------------------------------------
-- 6. TIENDAS (1)
--    proveedor_id se deja en NULL: es el caso más común (tienda
--    minorista independiente, no operada por un proveedor).
-- ---------------------------------------------------------------------
INSERT INTO tiendas (nombre, direccion, zona_id, formato, numero_sucursal, tiene_web_propia, activo)
SELECT
    'Super Valle Centro',
    'Av. Vasconcelos 402, San Pedro Garza García, N.L.',
    z.id,
    'supermercado',
    'SUC-001',
    FALSE,
    TRUE
FROM zonas z
WHERE z.nombre = 'Zona Valle';

-- ---------------------------------------------------------------------
-- 7. CATEGORÍAS DE PRODUCTO (1)
-- ---------------------------------------------------------------------
INSERT INTO categorias_producto (nombre, descripcion) VALUES
    ('Abarrotes', 'Productos básicos de despensa: granos, semillas y cereales.')
ON CONFLICT (nombre) DO NOTHING;

-- ---------------------------------------------------------------------
-- 8. PRODUCTOS (1)
--    proveedor_id se deja en NULL (alta interna, no propuesta por un
--    proveedor); aprobado_por referencia al usuario Gerente de
--    categoría creado en el paso 2, como correspondería en el flujo
--    real de aprobación de catálogo.
-- ---------------------------------------------------------------------
INSERT INTO productos (sku, nombre, descripcion, categoria_id, unidad_medida, es_canasta_basica, estatus, aprobado_por)
SELECT
    'P-001-001',
    'Frijol negro 1 kg',
    'Frijol negro a granel, empaque de 1 kilogramo.',
    c.id,
    'kg',
    TRUE,
    'activo',
    u.id
FROM categorias_producto c
CROSS JOIN usuarios u
WHERE c.nombre = 'Abarrotes'
  AND u.email = 'gercategoria@retail.mx'
ON CONFLICT (sku) DO NOTHING;

COMMIT;
