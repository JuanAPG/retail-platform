-- =====================================================================
-- Sprint 4 · recommendations-workflow-service (T-16, D-41)
--
-- Para una base que YA existe (volumen creado antes de este cambio).
-- `db/schema.sql` ya trae estas tablas para un volumen nuevo; este archivo
-- lleva una base vieja al mismo estado SIN recrear el volumen ni perder
-- datos. Es idempotente: se puede correr varias veces.
--
--   docker exec -i retail_postgres psql -U retail_user -d retaildb \
--     < db/migraciones/sprint4_recommendations_workflow.sql
-- =====================================================================

BEGIN;

-- Un seguimiento por recomendación (recomendacion_id ÚNICO). Sin llave foránea a
-- `recomendaciones` (es de decision-service: se valida por HTTP) ni a `usuarios`
-- (es de auth-service): contrato §11.
CREATE TABLE IF NOT EXISTS recomendacion_seguimientos (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recomendacion_id        UUID NOT NULL UNIQUE,
    estado                  VARCHAR(20) NOT NULL DEFAULT 'asignada'
                            CHECK (estado IN ('asignada','en_implementacion','implementada','evaluada')),
    asignado_a              UUID NOT NULL,
    asignado_por            UUID NOT NULL,
    asignado_en             TIMESTAMPTZ NOT NULL DEFAULT now(),
    fecha_compromiso        DATE,
    nota_asignacion         VARCHAR(1000),
    iniciado_en             TIMESTAMPTZ,
    implementado_el         DATE,
    implementado_en         TIMESTAMPTZ,
    nota_implementacion     VARCHAR(1000),
    evaluado_por            UUID,
    evaluado_en             TIMESTAMPTZ,
    metrica                 VARCHAR(20) CHECK (metrica IN ('ventas_unidades','ventas_importe','precio_unitario')),
    unidad                  VARCHAR(10) CHECK (unidad IN ('pza','MXN','MXN/kg','MXN/l','MXN/pza')),
    alcance_zona_id         UUID,
    alcance_tienda_id       UUID,
    alcance_presentacion_id UUID,
    antes_desde             DATE,
    antes_hasta             DATE,
    antes_valor             NUMERIC(14,2) CHECK (antes_valor > 0),
    despues_desde           DATE,
    despues_hasta           DATE,
    despues_valor           NUMERIC(14,2) CHECK (despues_valor >= 0),
    variacion_pct           NUMERIC(14,2),
    fuente                  VARCHAR(300),
    comentario              VARCHAR(1000),
    correlation_id          VARCHAR(100),
    CONSTRAINT chk_seguimiento_asignado CHECK (asignado_a <> asignado_por),
    -- Lo que cada estado ya debe tener (y lo que todavía no).
    CONSTRAINT chk_seguimiento_inicio CHECK ((estado = 'asignada') = (iniciado_en IS NULL)),
    CONSTRAINT chk_seguimiento_implementacion CHECK (
        (estado IN ('asignada','en_implementacion')) =
        (implementado_el IS NULL AND implementado_en IS NULL AND nota_implementacion IS NULL)
    ),
    CONSTRAINT chk_seguimiento_evaluacion CHECK (
        (estado = 'evaluada') = (evaluado_por IS NOT NULL AND evaluado_en IS NOT NULL AND metrica IS NOT NULL
            AND unidad IS NOT NULL AND antes_desde IS NOT NULL AND antes_hasta IS NOT NULL AND antes_valor IS NOT NULL
            AND despues_desde IS NOT NULL AND despues_hasta IS NOT NULL AND despues_valor IS NOT NULL
            AND variacion_pct IS NOT NULL AND fuente IS NOT NULL)
    ),
    CONSTRAINT chk_seguimiento_alcance CHECK (
        estado <> 'evaluada' OR alcance_zona_id IS NOT NULL OR alcance_tienda_id IS NOT NULL OR alcance_presentacion_id IS NOT NULL
    ),
    CONSTRAINT chk_seguimiento_periodos CHECK (
        antes_desde IS NULL OR (antes_desde <= antes_hasta AND antes_hasta < despues_desde AND despues_desde <= despues_hasta)
    )
);
COMMENT ON TABLE recomendacion_seguimientos IS 'Seguimiento de una recomendación aceptada (D-41): responsable asignado, avance (asignada → en_implementacion → implementada → evaluada) y la evaluación de impacto con su métrica. Uno por recomendación. Dueño: recommendations-workflow-service.';

CREATE INDEX IF NOT EXISTS idx_seguimientos_asignado ON recomendacion_seguimientos (asignado_a, asignado_en);
CREATE INDEX IF NOT EXISTS idx_seguimientos_estado ON recomendacion_seguimientos (estado, asignado_en);

CREATE TABLE IF NOT EXISTS seguimiento_eventos (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seguimiento_id      UUID NOT NULL REFERENCES recomendacion_seguimientos(id) ON DELETE RESTRICT,
    evento              VARCHAR(15) NOT NULL CHECK (evento IN ('asignada','iniciada','implementada','evaluada')),
    estado_previo       VARCHAR(20) CHECK (estado_previo IN ('asignada','en_implementacion','implementada')),
    estado_nuevo        VARCHAR(20) NOT NULL CHECK (estado_nuevo IN ('asignada','en_implementacion','implementada','evaluada')),
    actor_id            UUID NOT NULL,
    ocurrido_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
    correlation_id      VARCHAR(100),
    -- 'pendiente' mientras la entrega sigue en curso (fire-and-forget, §10).
    auditoria_estado    VARCHAR(10) NOT NULL DEFAULT 'pendiente'
                        CHECK (auditoria_estado IN ('enviado','fallido','pendiente','no_aplica')),
    auditoria_error     TEXT,
    aviso_estado        VARCHAR(10) NOT NULL DEFAULT 'pendiente'
                        CHECK (aviso_estado IN ('enviado','fallido','pendiente','no_aplica')),
    aviso_error         TEXT,
    UNIQUE (seguimiento_id, evento)
);
COMMENT ON TABLE seguimiento_eventos IS 'Bitácora propia del seguimiento (asignada, iniciada, implementada, evaluada): actor, instante, correlación y estado de entrega de la auditoría y el aviso (§10, visible en /history). Solo se anexa; solo cambian los estados de entrega. Dueño: recommendations-workflow-service.';

CREATE INDEX IF NOT EXISTS idx_seguimiento_eventos_seguimiento ON seguimiento_eventos (seguimiento_id, ocurrido_en);

COMMIT;
