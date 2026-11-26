BEGIN;
CREATE TABLE IF NOT EXISTS lotes_ingesta_ventas (
    id uuid PRIMARY KEY,
    owner_id uuid NOT NULL,
    format text NOT NULL CHECK (format IN ('csv','json','xml')),
    sha256 char(64) NOT NULL,
    size_bytes integer NOT NULL,
    filename text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    state text NOT NULL DEFAULT 'vista_previa'
        CHECK (state IN ('vista_previa','confirmando','conciliacion','confirmado','descartado')),
    object_key text,
    generation text,
    original bytea,
    CHECK ((original IS NOT NULL AND object_key IS NULL AND generation IS NULL)
        OR (original IS NULL AND object_key IS NOT NULL AND generation IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_lotes_ingesta_owner ON lotes_ingesta_ventas(owner_id, created_at DESC);
CREATE TABLE IF NOT EXISTS ventas_en_lote (
    batch_id uuid NOT NULL REFERENCES lotes_ingesta_ventas(id),
    sale_no integer NOT NULL,
    payload jsonb NOT NULL,
    result text NOT NULL DEFAULT 'valida'
        CHECK (result IN ('valida','insertada','repetida','conflicto','rechazada')),
    transaction_id uuid,
    code text,
    message text,
    PRIMARY KEY (batch_id, sale_no)
);
CREATE INDEX IF NOT EXISTS idx_ventas_en_lote_pendientes
    ON ventas_en_lote(batch_id, sale_no) WHERE result='valida';
CREATE TABLE IF NOT EXISTS filas_ingesta_ventas (
    batch_id uuid NOT NULL REFERENCES lotes_ingesta_ventas(id),
    row_no integer NOT NULL,
    sale_no integer,
    result text NOT NULL CHECK (result IN ('valida','rechazada','conflicto')),
    code text,
    message text,
    PRIMARY KEY (batch_id, row_no),
    FOREIGN KEY (batch_id, sale_no) REFERENCES ventas_en_lote(batch_id, sale_no)
);
COMMIT;
