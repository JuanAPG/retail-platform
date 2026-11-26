-- =====================================================================
-- Sprint 4 · promotion-service (T-07, D-39)
--
-- Para una base que YA existe (volumen creado antes de este cambio).
-- `db/schema.sql` ya trae estas tablas para un volumen nuevo; este archivo
-- lleva una base vieja al mismo estado SIN recrear el volumen ni perder
-- datos. Es idempotente: se puede correr varias veces.
--
--   docker exec -i retail_postgres psql -U retail_user -d retaildb \
--     < db/migraciones/sprint4_promotion.sql
-- =====================================================================

BEGIN;

-- Sin llaves foráneas a tablas de otros dueños (contrato §13): producto,
-- presentación, tienda, zona y usuarios se validan por HTTP. La unidad y el
-- contenido de la presentación se guardan al proponer, para calcular el
-- precio unitario sin depender de que el catálogo la siga mostrando.
CREATE TABLE IF NOT EXISTS promociones (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre                  VARCHAR(120) NOT NULL CHECK (char_length(nombre) >= 3),
    tipo                    VARCHAR(24)  NOT NULL CHECK (tipo IN ('descuento_porcentual','paquete','tamano_empaque')),
    producto_id             UUID NOT NULL,
    presentacion_id         UUID NOT NULL,
    tienda_id               UUID,
    zona_id                 UUID,
    descuento_pct           NUMERIC(5,2)  CHECK (descuento_pct > 0 AND descuento_pct < 100),
    paquete_cantidad        SMALLINT      CHECK (paquete_cantidad BETWEEN 2 AND 99),
    paquete_precio          NUMERIC(12,2) CHECK (paquete_precio > 0),
    empaque_contenido       NUMERIC(12,3) CHECK (empaque_contenido > 0),
    empaque_unidad          VARCHAR(10),
    empaque_factor          NUMERIC(14,6) CHECK (empaque_factor > 0),
    empaque_precio          NUMERIC(12,2) CHECK (empaque_precio > 0),
    presentacion_contenido  NUMERIC(12,3) NOT NULL CHECK (presentacion_contenido > 0),
    presentacion_unidad     VARCHAR(10)   NOT NULL,
    presentacion_factor     NUMERIC(14,6) NOT NULL CHECK (presentacion_factor > 0),
    unidad_tipo             VARCHAR(10)   NOT NULL CHECK (unidad_tipo IN ('masa','volumen','pieza')),
    vigente_desde           DATE NOT NULL,
    vigente_hasta           DATE NOT NULL,
    estatus                 VARCHAR(10) NOT NULL DEFAULT 'pendiente' CHECK (estatus IN ('pendiente','aprobada','rechazada')),
    propuesto_por           UUID NOT NULL,
    propuesto_en            TIMESTAMPTZ NOT NULL DEFAULT now(),
    resuelto_por            UUID,
    resuelto_en             TIMESTAMPTZ,
    motivo_rechazo          VARCHAR(500),
    correlation_id          VARCHAR(100),
    CONSTRAINT chk_promocion_ambito CHECK ((tienda_id IS NULL) <> (zona_id IS NULL)),
    CONSTRAINT chk_promocion_vigencia CHECK (vigente_hasta >= vigente_desde),
    CONSTRAINT chk_promocion_campos CHECK (
        (tipo = 'descuento_porcentual' AND descuento_pct IS NOT NULL
            AND paquete_cantidad IS NULL AND paquete_precio IS NULL
            AND empaque_contenido IS NULL AND empaque_unidad IS NULL AND empaque_factor IS NULL AND empaque_precio IS NULL)
     OR (tipo = 'paquete' AND paquete_cantidad IS NOT NULL AND paquete_precio IS NOT NULL
            AND descuento_pct IS NULL
            AND empaque_contenido IS NULL AND empaque_unidad IS NULL AND empaque_factor IS NULL AND empaque_precio IS NULL)
     OR (tipo = 'tamano_empaque' AND empaque_contenido IS NOT NULL AND empaque_unidad IS NOT NULL
            AND empaque_factor IS NOT NULL AND empaque_precio IS NOT NULL
            AND descuento_pct IS NULL AND paquete_cantidad IS NULL AND paquete_precio IS NULL)
    ),
    CONSTRAINT chk_promocion_resolucion CHECK (
        (estatus = 'pendiente' AND resuelto_por IS NULL AND resuelto_en IS NULL AND motivo_rechazo IS NULL)
     OR (estatus = 'aprobada'  AND resuelto_por IS NOT NULL AND resuelto_en IS NOT NULL AND motivo_rechazo IS NULL)
     OR (estatus = 'rechazada' AND resuelto_por IS NOT NULL AND resuelto_en IS NOT NULL
            AND char_length(motivo_rechazo) BETWEEN 10 AND 500)
    )
);
COMMENT ON TABLE promociones IS 'Promociones propuestas por el Gerente de categoría y resueltas por el Responsable de precios (D-39): descuento porcentual, paquete n por $ o tamaño de empaque. No toca precios ni elasticidades. Dueño: promotion-service.';

CREATE INDEX IF NOT EXISTS idx_promociones_estatus_propuesto ON promociones (estatus, propuesto_en);
CREATE INDEX IF NOT EXISTS idx_promociones_presentacion ON promociones (presentacion_id, vigente_desde, vigente_hasta);
CREATE INDEX IF NOT EXISTS idx_promociones_producto ON promociones (producto_id);

CREATE TABLE IF NOT EXISTS promocion_eventos (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    promocion_id        UUID NOT NULL REFERENCES promociones(id) ON DELETE RESTRICT,
    evento              VARCHAR(10) NOT NULL CHECK (evento IN ('propuesta','aprobada','rechazada')),
    actor_id            UUID NOT NULL,
    ocurrido_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
    correlation_id      VARCHAR(100),
    -- 'pendiente' mientras la entrega sigue en curso (fire-and-forget, §14).
    auditoria_estado    VARCHAR(10) NOT NULL DEFAULT 'pendiente'
                        CHECK (auditoria_estado IN ('pendiente','enviado','fallido','no_aplica')),
    auditoria_error     TEXT,
    aviso_estado        VARCHAR(10) NOT NULL DEFAULT 'pendiente'
                        CHECK (aviso_estado IN ('pendiente','enviado','fallido','no_aplica')),
    aviso_error         TEXT,
    UNIQUE (promocion_id, evento)
);
COMMENT ON TABLE promocion_eventos IS 'Bitácora propia de promotion-service (propuesta, aprobada, rechazada) con el estado de entrega de la auditoría y del aviso (§14). Solo se anexa; solo cambian los estados de entrega. Dueño: promotion-service.';

COMMIT;
