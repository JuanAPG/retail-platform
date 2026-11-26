-- T-19. Ejecutar con los escritores detenidos antes de arrancar audit-service.
BEGIN;
LOCK TABLE auditoria, auditoria_cambios IN ACCESS EXCLUSIVE MODE;
SELECT set_config('audit.backfill', (NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'auditoria'::regclass AND attname = 'hash' AND NOT attisdropped
))::text, true);
ALTER TABLE auditoria
    ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(100),
    ADD COLUMN IF NOT EXISTS hash_anterior TEXT,
    ADD COLUMN IF NOT EXISTS hash TEXT;
CREATE INDEX IF NOT EXISTS idx_auditoria_correlation ON auditoria(correlation_id);

-- El hash usa fechas como epoch (sin huso) y cambios en orden binario por campo.
CREATE OR REPLACE FUNCTION auditoria_hash(evento_id bigint, anterior text)
RETURNS text LANGUAGE sql STABLE AS $$
    SELECT encode(sha256(convert_to(jsonb_build_array(
        'v1', anterior, a.id, a.usuario_id, a.rol_id, a.tabla_afectada, a.registro_id,
        a.servicio, a.accion, a.descripcion, a.direccion_ip, extract(epoch FROM a.fecha),
        a.correlation_id, COALESCE((
            SELECT jsonb_agg(jsonb_build_array(c.campo, c.valor_previo, c.valor_posterior)
                             ORDER BY c.campo COLLATE "C")
            FROM auditoria_cambios c WHERE c.auditoria_id = a.id
        ), '[]'::jsonb)
    )::text, 'UTF8')), 'hex')
    FROM auditoria a WHERE a.id = evento_id;
$$;

-- Se ejecuta bajo el bloqueo adquirido antes de asignar el ID del evento.
CREATE OR REPLACE FUNCTION auditoria_sellar(evento_id bigint)
RETURNS void LANGUAGE sql AS $$
    UPDATE auditoria a
       SET hash_anterior = previo.hash, hash = auditoria_hash(evento_id, previo.hash)
      FROM (SELECT (SELECT b.hash FROM auditoria b
                    WHERE b.id < evento_id ORDER BY b.id DESC LIMIT 1) AS hash) previo
     WHERE a.id = evento_id AND a.hash IS NULL;
$$;

-- Solo sella la bitácora preexistente en la primera aplicación. Una
-- reejecución conserva incluso las discontinuidades que se deban investigar.
DO $$
DECLARE evento_id bigint;
BEGIN
    IF current_setting('audit.backfill')::boolean THEN
        FOR evento_id IN SELECT id FROM auditoria ORDER BY id LOOP
            PERFORM auditoria_sellar(evento_id);
        END LOOP;
    END IF;
END $$;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'auditoria'::regclass AND conname = 'chk_auditoria_servicio') THEN
        ALTER TABLE auditoria ADD CONSTRAINT chk_auditoria_servicio CHECK (servicio IN (
           'auth-service', 'catalog-service', 'pricing-service',
       'core-process-service', 'algorithms-core', 'analytics-stats',
       'decision-service', 'documents-service', 'notifications-service',
       'audit-service', 'transactions-ingestion-service', 'income-segmentation-service',
       'basket-analysis-service', 'availability-service', 'promotion-service',
       'demand-forecast-service', 'recommendations-workflow-service', 'offline-sync-service',
       'data-governance-service', 'monitoring-service'
        )) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'auditoria'::regclass AND conname = 'chk_auditoria_correlation') THEN
        ALTER TABLE auditoria ADD CONSTRAINT chk_auditoria_correlation
            CHECK (correlation_id ~ '^[A-Za-z0-9._:-]{1,100}$');
    END IF;
END $$;
COMMIT;
