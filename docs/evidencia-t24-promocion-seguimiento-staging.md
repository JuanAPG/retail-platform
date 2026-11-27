# Evidencia T-24 en staging: promoción y seguimiento de una recomendación

Responsable: Pamela (web del Gerente). Origen `https://34.51.89.203`, `main` en `309d381`,
27-nov-2026 (UTC 06:56:42 a 06:56:46). Cuentas sintéticas del seed. **Sin JWT ni URLs firmadas.**

Toda la operación viajó con un solo `X-Correlation-Id`: **`t24-pamela-a82a7a61`**.
Antes de empezar, el monitor reportó los 20 servicios `operativo`.

| # | Paso (quién y desde dónde en el producto) | HTTP | Resultado |
|---|---|---|---|
| 1 | El **Gerente** propone una promoción de 10 % en una zona (web, D-39) | 201 | `pendiente` |
| 2 | El **Responsable de precios** la aprueba (escritorio; aquí por API) | 200 | `aprobada` |
| 3 | El **Gerente** aprueba una recomendación propuesta (D-12) | 200 | `aceptada` |
| 4 | El **Gerente** asigna el seguimiento a un Analista elegido de `GET /v1/usuarios/asignables` (web, D-41) | 201 | `asignada` |
| 5 | El **Analista** asignado lo inicia (escritorio; aquí por API) | 200 | `en_implementacion` |
| 6 | El **Analista** lo marca implementado | 200 | `implementada` |
| 7 | El **Gerente** evalúa el impacto: ventas en piezas 1,000 → 1,150 (web) | 200 | `evaluada`, **variación 15 %** (caso de control de D-41) |
| 8 | El **Auditor** busca la correlación en la bitácora | 200 | **6 eventos**: 2 de promotion-service y 4 de recommendations-workflow-service |
| 9 | El **Auditor** verifica la cadena SHA-256 de esa correlación | 200 | `integra: true` |

Cada respuesta devolvió el mismo `X-Correlation-Id`.

## Hallazgo

- La aprobación de la recomendación (paso 3, decision-service) **no aparece en la bitácora con la
  correlación**: decision-service aún no reenvía `X-Correlation-Id` a audit-service (T-02).
  Responsable: Fernando.
- En una primera corrida (correlación descartada) el paso 5 dio `403` porque se asignó a otro
  Analista del dataset grande: solo el usuario asignado puede iniciar, como dice el contrato.
