# Evidencia: reportes privados en GCS (documents-service, staging)

Responsable: Pamela. Complementa el caso de GCS pendiente en
[pruebas de fallos](../infra/staging/pruebas-de-fallos.md). Origen `http://34.51.89.203`,
`main` en `2df0506` al registrar. Cuentas sintéticas del seed. **No se incluyen JWT ni URLs firmadas.**

## Recorrido del 26-nov-2026 (escritura, aviso y descarga)

| Paso | Resultado |
|---|---|
| Analista edita ING_1 en income-segmentation (3112) | `PATCH` 200, versión 1 → **2**; historial v2, v1 (D-35). |
| Gerente prepara el CSV del reporte `6b086dae2c60da718a10fbdd` | `201`, estado `disponible`, almacén **`gcs`**, 1733 bytes. |
| Aviso `reporte.generado` (T-20) | Llegó a la bandeja del Gerente con el **mismo `X-Correlation-Id`** de la petición. |
| Descarga | URL firmada 200, vigencia 300 s (D-50), `GET` 200, **SHA-256 igual al registrado**. |

## Lectura autorizada y expiración de la firma V4 (27-nov-2026, UTC)

Archivo `f052fea5-3427-4ca1-95a5-976061f88797` (CSV, 1733 bytes, bucket `gcs_bucket_reportes`),
correlación `evid-gcs-37ac9e0d`.

| Paso | Hora UTC | Resultado |
|---|---|---|
| Emisión de la URL (Gerente) | 01:52:14.683 | `POST …/download-url` **200**, `ttlSegundos` 300, vence 01:57:13.947; firmada por `storage.googleapis.com` con `X-Goog-Algorithm=GOOG4-…` (**V4**). |
| Lectura dentro de la vigencia | 01:52:14.693 | `GET` **200**, 1733 bytes, **hash igual** al registro. |
| Misma URL tras vencer | 01:57:29.108 | `GET` **400 `ExpiredToken`** (respuesta de GCS). |
| Nueva URL y lectura | 01:57:29.575 | `POST` 200 → `GET` 200, hash igual: vencer no afecta al objeto. |

## Pendiente (requiere identidad de GCP de la VM)

- Interrupción controlada del bucket (p. ej. quitar el permiso de escritura a la cuenta de servicio)
  durante la preparación de un archivo: se espera `503`, registro `fallido` y sin aviso; al
  restituirlo, el reintento debe quedar `disponible` con un solo aviso. Ese comportamiento ya está
  probado con el doble local en `services/documents-service/test/archivos.spec.ts` (14/14).
