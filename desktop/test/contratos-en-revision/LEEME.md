# Contrato de ingesta EN REVISIÓN (copia para pruebas)

Copia exacta de la rama `docs/contratos-ingestion-monitoring` (PR #96, commit 4685c13), que
todavía no está en `main`:

- `transactions-ingestion-service.xsd`
- `xsd/error-transversal.xsd` (lo incluye el XSD de arriba)
- `ejemplos/ingestion-ventas.xml` y `ejemplos/ingestion-objeto.xml`

Solo la usan las pruebas (`test/xsd.test.ts`). Cuando el PR #96 se fusione, se borra esta
carpeta y las pruebas apuntan a `docs/contratos/` como con los demás servicios.
