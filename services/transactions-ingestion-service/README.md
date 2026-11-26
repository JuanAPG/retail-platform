# transactions-ingestion-service · 3111

El Analista carga un CSV, JSON o XML, revisa las filas y confirma el lote
desde el portal web. La API conserva los resultados y reanuda ventas
pendientes cuando Core no devuelve acuse. Core identifica una venta por
tienda y folio.

```sh
./infra/migrar-postgres.sh
docker compose -f infra/docker-compose.yml up -d --build transactions-ingestion-service core-process-service catalog-service auth-service
python3 services/transactions-ingestion-service/test/integration.py
```

La prueba usa la semilla sintética y crea lotes y una venta en la base.
Comprueba vista previa de 5.001 filas en ambos servicios, error por fila,
confirmación repetida y un nuevo lote con el mismo contenido.

En local, PostgreSQL conserva los originales cuando
`GCS_INGESTION_BUCKET` está vacío. En staging, configura el bucket privado
y usa credenciales de carga con permisos de crear y leer objetos. Para
`from-object`, el objeto debe estar en
`<GCS_INGESTION_INCOMING_PREFIX>/<UUID del usuario>/<archivo>`, llevar
`ownerId` en sus metadatos y referenciar una generación exacta. El
proceso que cargue ese objeto debe aplicar los mismos permisos. El
Dockerfile incluye xmllint y los XSD. Los límites predeterminados son
8 MiB y 10.000 filas.

Para el portal configura `VITE_INGESTION_URL` con el origen del servicio
o el prefijo HTTPS de Caddy sin `/v1`. El escritorio conserva su flujo CSV
legado hasta adoptar [el contrato](../../docs/contratos/transactions-ingestion-service.md).
Los acuses persistidos conservan el UUID de la venta y Core conserva el
UUID del lote de origen. La publicación en gobierno de datos depende de
la incorporación de ese servicio.
