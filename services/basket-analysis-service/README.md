# basket-analysis-service (3113 · T-12)

Canasta típica de un grupo **zona + segmento** (D-37: productos en al menos el 20 % de las
canastas), comparación entre dos periodos, evolución semanal o mensual y mezcla del gasto por
categoría. Cada resultado respeta D-36 (no se publica con menos de 10 transacciones y 3 tiendas).

Contrato: [`docs/contratos/basket-analysis-service.md`](../../docs/contratos/basket-analysis-service.md)
y su XSD (namespace `basket-analysis/v1`). Parte de `services/template-fastapi/`.

No guarda nada: calcula al vuelo con lecturas HTTP a core-process, catalog e
income-segmentation. Sin PostgreSQL ni MongoDB; Redis solo para la sesión.

## Probar

```bash
pip install -r requirements-dev.txt
python -m pytest
```

O sin instalar nada local, en el mismo Python del Dockerfile (desde la raíz del repo):

```bash
docker run --rm -v "$PWD":/repo -w /repo/services/basket-analysis-service python:3.12-slim \
  sh -c "pip install -q -r requirements-dev.txt && python -m pytest"
```

## Variables

Ver `.env.example`.
