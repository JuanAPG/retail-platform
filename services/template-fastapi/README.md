# Plantilla FastAPI transversal

Base de los servicios en Python (`analytics-stats` y los nuevos del Sprint 4 que lo
declaren en su contrato). Espejo de la plantilla Nest: mismo cuerpo de error, mismo
logging, misma validación JWT+Redis, mismo `/v1/health` y mismo id de correlación.

## Qué trae resuelto

- `GET /v1/health` sin auth, con `postgres`, `mongodb` y `redis` (`no configurado` si el
  servicio no usa esa dependencia), `latencyMs` por check y `durationMs` total. Los checks
  corren en paralelo. Esquema: `docs/contratos/health.xsd` (`app/main.py`).
- **Id de correlación** `X-Correlation-Id` (T-02): se toma de la petición o se genera, se
  devuelve en la respuesta (también en XML), va en cada línea de log y se reenvía con
  `con_correlacion()` (`app/correlacion.py`).
- Error estándar en `app/errors.py` (misma forma que Nest)
- `LoggingMiddleware` (`app/logging_conf.py`)
- Negociación XML por `Accept` (misma `main.py`; XSD en `docs/contratos/`)
- Dependencia `sesion_actual` (`app/auth_session.py`): JWT + Redis, úsala con
  `Depends(sesion_actual)` en cada endpoint protegido.

## Crear un servicio nuevo (7 pasos)

Antes: el contrato `docs/contratos/<servicio>.md` + `.xsd` revisado y la fila de
permisos en la Matriz §3.2 (ver `CONTRIBUTING.md`).

```bash
# 1. Copia la plantilla
cp -r services/template-fastapi services/<servicio>
cd services/<servicio>
# 2. .env.example y el bloque en infra/docker-compose.yml: PORT (3111–3120),
#    SERVICE_NAME y XML_NAMESPACE (el targetNamespace de tu XSD)
```

3. **Dependencias que uses** en `requirements.txt`: Postgres → `psycopg2-binary`; Mongo →
   `pymongo` y `MONGO_URL`. El health las detecta solo: sin driver o sin `MONGO_URL`
   reporta `no configurado`.
4. **Routers** con prefijo `/v1/`, protegidos con `Depends(sesion_actual)` y los roles de
   la Matriz; declara la raíz XML de cada ruta con `xml_root(ruta, elemento)`.
5. **Llamadas a otros servicios:** `httpx.get(url, headers=con_correlacion({"Authorization": token}), timeout=3)`;
   audit y notifications sin bloquear.
6. **Pruebas** en `tests/` (las de la plantilla, `tests/test_plantilla.py`, deben seguir
   pasando): `pip install -r requirements-dev.txt && python -m pytest`.
7. **Verifica:** `docker compose -f infra/docker-compose.yml up -d <servicio>` y
   `curl -i localhost:<PORT>/v1/health` (debe traer `X-Correlation-Id`).

## Probarla sola

```bash
pip install -r requirements-dev.txt
python -m pytest
PORT=3006 SERVICE_NAME=plantilla-test uvicorn app.main:app --reload
curl -i localhost:3006/v1/health
curl -H 'Accept: application/xml' -i localhost:3006/v1/health
```
