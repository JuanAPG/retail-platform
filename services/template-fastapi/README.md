# Plantilla FastAPI transversal (Sprint 2+3)

Base de `analytics-stats`. Espejo de la plantilla Nest: mismo cuerpo de
error, mismo logging, misma validación JWT+Redis, mismo `/v1/health`.

## Qué trae resuelto

- `GET /v1/health` sin auth (`app/main.py`)
- Error estándar en `app/errors.py` (misma forma que Nest)
- `LoggingMiddleware` (`app/logging_conf.py`)
- Negociación XML por `Accept` (misma `main.py`; XSD en `docs/contratos/`)
- Dependencia `sesion_actual` (`app/auth_session.py`): JWT + Redis, úsala con
  `Depends(sesion_actual)` en cada endpoint protegido.

## Cómo copiarme (3 pasos)

```bash
cp -r services/template-fastapi services/<nuevo-servicio>
cd services/<nuevo-servicio>
# 1. En .env.example y docker-compose: fija PORT y SERVICE_NAME
# 2. Agrega tus routers con prefijo /v1/ y protege con Depends(sesion_actual)
# 3. Documenta ejemplos JSON y XML en cada endpoint
```

## Probarla sola

```bash
pip install -r requirements.txt
PORT=3006 SERVICE_NAME=plantilla-test uvicorn app.main:app --reload
curl localhost:3006/v1/health
curl -H 'Accept: application/xml' localhost:3006/v1/health
```
