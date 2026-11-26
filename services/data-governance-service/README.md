# data-governance-service (3119 · T-14)

Gobierno de datos (D-43): **fuentes** de datos y sus **versiones**, **linaje** de cada importación,
versión de segmento y corrida ("¿de dónde salió este resultado?"), **calidad** por fuente y
**retención** (políticas, evaluación y simulación).

Contrato: [`docs/contratos/data-governance-service.md`](../../docs/contratos/data-governance-service.md)
y su XSD (namespace `governance/v1`). Parte de `services/template-fastapi/`.

Tablas propias en el Postgres compartido (D-47), con su migración en
`db/migraciones/sprint4_data_governance.sql`. Sin MongoDB; Redis solo para la sesión.

## Probar

```bash
pip install -r requirements-dev.txt
python -m pytest
```

O sin instalar nada local, en el mismo Python del Dockerfile (desde la raíz del repo):

```bash
docker run --rm -v "$PWD":/repo -w /repo/services/data-governance-service python:3.12-slim \
  sh -c "pip install -q -r requirements-dev.txt && python -m pytest"
```

## Variables

Ver `.env.example`.
