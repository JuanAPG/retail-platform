# demand-forecast-service (3116 · T-13)

Pronóstico semanal de demanda por **producto y zona** con Holt-Winters (D-40): 8 semanas,
intervalos de 80 % y 95 %, validación con las últimas 4 semanas (MAPE) y `422` con menos de 12
semanas de historia. Las corridas se guardan en MongoDB (`forecast_runs`, D-47) con la serie que
usaron, para repetirlas (D-15).

Contrato: [`docs/contratos/demand-forecast-service.md`](../../docs/contratos/demand-forecast-service.md)
y su XSD (namespace `forecast/v1`). Parte de `services/template-fastapi/`.

## Probar

Con Python 3.12 (statsmodels 0.14.4 no tiene versión para 3.13+):

```bash
pip install -r requirements-dev.txt
python -m pytest
```

O sin instalar nada local, en el mismo Python del Dockerfile:

```bash
docker run --rm -v "$PWD":/app -w /app python:3.12-slim \
  sh -c "pip install -q -r requirements-dev.txt && python -m pytest"
```

## Variables

Ver `.env.example`. Sin PostgreSQL: el servicio no lee ni escribe tablas.
