# Contrato transversal: paginación (Fase A)

Vale para los 10 microservicios. Los clientes (web, móvil, escritorio) programan
contra esto una sola vez, no por servicio.

## Parámetros (query, todos opcionales)

| Parámetro | Default | Reglas |
|---|---|---|
| `page` | `1` | Entero mayor a 0. Fuera de rango → `data: []`, nunca error |
| `limit` | `20` | Entero entre 1 y 100. Mayor a 100 se recorta a 100 |

## Respuesta (JSON)

```json
{ "data": [ … ], "total": 106, "page": 2, "limit": 20 }
```

`total` es el conteo sin paginar (para dibujar *"página 2 de 6"*). Orden default:
recientes primero; cada endpoint puede fijar otro orden en su contrato.

## Respuesta (XML)

Misma envoltura bajo `<response>`:

```xml
<response>
  <data><item>…</item></data>
  <total>106</total>
  <page>2</page>
  <limit>20</limit>
</response>
```

Todo arreglo se envuelve en `<item>` por elemento (nunca se repite la
etiqueta padre); arreglo vacío → `<data/>` autocerrada. El interceptor Nest
y el `_llenar` de FastAPI producen exactamente la misma forma.

## Excepciones declaradas (no se paginan)

- Agregados para gráficas (Highcharts): se sirven agregados del servidor.
- Cálculos al vuelo con tope propio (p. ej. sustituciones, `limit` top-N).
- Catálogos chicos e inmutables en la práctica (unidades de medida,
  municipios, roles): devuelven arreglo plano y lo declaran en su contrato.
- Series completas para un cálculo, acotadas por el filtro obligatorio del endpoint (p. ej.
  `GET /v1/prices/series?presentationId=…`): la elasticidad necesita el periodo completo y no
  una página de 100.

## Plantilla

- Nest: `PaginationDto` + `paginar(qb, filtros)` en
  `services/template-nest/src/common/` (ya copiado a los 10 scaffolds).
- FastAPI: `app/pagination.py` (`normalizar`, `paginar`, `desplazamiento`).
