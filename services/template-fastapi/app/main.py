"""Raíz de la plantilla FastAPI. Cada endpoint de negocio cuelga de /v1/.
`/docs` queda fuera del versionado. Responde JSON y XML según `Accept`
(igual que el interceptor Nest); el XSD de cada endpoint vive en
`docs/contratos/` (Fase A).
"""
import os
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import Response
from starlette.exceptions import HTTPException as StarletteHTTPException

from .errors import cuerpo_error
from .logging_conf import LoggingMiddleware
from .xml_out import CONTENT_TYPE_XML, quiere_xml, serializar_xml

app = FastAPI(
    title=os.getenv("SERVICE_NAME", "unknown-service"),
    version=os.getenv("SERVICE_VERSION", "1.0.0"),
    docs_url="/docs",
    redoc_url=None,
)
app.add_middleware(LoggingMiddleware)


@app.exception_handler(StarletteHTTPException)
async def manejador_http(request: Request, error: StarletteHTTPException):
    detalle = error.detail if isinstance(error.detail, str) else None
    datos = None if isinstance(error.detail, str) else error.detail
    return cuerpo_error(error.status_code, detalle or "Error en la solicitud",
                        request.url.path, None, datos)


@app.exception_handler(RequestValidationError)
async def manejador_validacion(request: Request, error: RequestValidationError):
    # `details` como lista de textos, igual que el ValidationPipe de Nest
    # (`services/snippets/error-codes.md`). Los errores crudos de pydantic
    # traen el valor recibido: un NaN ahí hace que el JSON de la respuesta
    # no se pueda serializar y el 400 salga como 500.
    detalles = []
    for e in error.errors():
        # Un error de todo el cuerpo (loc = ("body",)) va sin ruta de campo.
        campo = ".".join(str(parte) for parte in e["loc"] if parte != "body")
        detalles.append(f"{campo}: {e['msg']}" if campo else e["msg"])
    return cuerpo_error(400, "Error de validación en la solicitud.",
                        request.url.path, "VALIDATION_ERROR", detalles)


@app.exception_handler(Exception)
async def manejador_general(request: Request, _error: Exception):
    return cuerpo_error(500, "Error interno del servidor.", request.url.path)


#: ruta -> (raiz del XSD, campos que van aunque sean nulos).
#: Equivalente al decorador `@XmlRoot` de la plantilla Nest: se declara
#: aqui porque en FastAPI el middleware no ve el handler, solo la ruta.
XML_ROOTS: dict[str, tuple[str, tuple[str, ...]]] = {}


def xml_root(ruta: str, elemento: str, siempre_presentes: tuple[str, ...] = ()) -> None:
    """Declara la raiz XML de una ruta, segun su XSD en `docs/contratos/`.

    Sin declararla, la ruta conserva `<response>` y no se rompe nada.
    """
    XML_ROOTS[ruta] = (elemento, siempre_presentes)


def _raiz_de(ruta: str) -> tuple[str | None, tuple[str, ...]]:
    if ruta in XML_ROOTS:
        return XML_ROOTS[ruta]
    # Coincidencia por prefijo para las rutas con parametros.
    for patron, valor in XML_ROOTS.items():
        if patron.endswith("*") and ruta.startswith(patron[:-1]):
            return valor
    return None, ()


@app.get("/v1/health", summary="Salud del servicio y de sus dependencias, con lo que tardó cada una.")
def salud():
    """Sin autenticación y SIEMPRE 200 si el proceso responde.

    Misma forma que la plantilla Nest (`docs/contratos/health.xsd`): siempre
    `postgres`, `mongodb` y `redis`; `latencyMs` por check y `durationMs`
    total (los usa monitoring-service, D-44). `status` es `degraded` cuando
    una dependencia falla. Asi el healthcheck de Docker distingue "proceso
    muerto" de "base caida".
    """
    return armar_salud({
        "postgres": _verificar_postgres,
        "mongodb": _verificar_mongo,
        "redis": _verificar_redis,
    })


def armar_salud(checks: dict) -> dict:
    """Corre los checks en paralelo (cada uno con su propio tope de 2 s)."""
    import time
    from concurrent.futures import ThreadPoolExecutor

    def medir(check):
        desde = time.monotonic()
        try:
            estado = check()
        except Exception as error:  # noqa: BLE001 - el health reporta, no falla
            estado = f"error: {error}"
        return estado, int((time.monotonic() - desde) * 1000)

    inicio = time.monotonic()
    with ThreadPoolExecutor(max_workers=len(checks) or 1) as hilos:
        resultados = dict(zip(checks, hilos.map(medir, checks.values())))
    estados = {nombre: estado for nombre, (estado, _) in resultados.items()}
    # "no configurado" no es una falla: significa que el servicio todavia no
    # usa esa dependencia. Solo un "error:" degrada el estado.
    degradado = any(v.startswith("error") for v in estados.values())
    return {
        "status": "degraded" if degradado else "ok",
        "service": os.getenv("SERVICE_NAME", "unknown-service"),
        "version": os.getenv("SERVICE_VERSION", "1.0.0"),
        "checks": estados,
        "latencyMs": {nombre: ms for nombre, (_, ms) in resultados.items()},
        "durationMs": int((time.monotonic() - inicio) * 1000),
        "timestamp": __import__("datetime").datetime.now(
            __import__("datetime").timezone.utc).isoformat(),
    }


def _verificar_mongo() -> str:
    """`no configurado` si el servicio no usa Mongo (sin pymongo o sin MONGO_URL)."""
    url = os.getenv("MONGO_URL")
    try:
        from pymongo import MongoClient  # type: ignore
    except ImportError:
        return "no configurado"
    if not url:
        return "no configurado"
    try:
        cliente = MongoClient(url, serverSelectionTimeoutMS=2000, connectTimeoutMS=2000)
        try:
            cliente.admin.command("ping")
        finally:
            cliente.close()
        return "ok"
    except Exception as error:  # noqa: BLE001
        return f"error: {error}"


def _verificar_redis() -> str:
    """`ok` o el motivo. Nunca lanza: el health no debe caerse."""
    try:
        import redis  # type: ignore

        cliente = redis.Redis(
            host=os.getenv("REDIS_HOST", "localhost"),
            port=int(os.getenv("REDIS_PORT", "6379")),
            socket_connect_timeout=2,
            socket_timeout=2,
        )
        cliente.ping()
        return "ok"
    except Exception as error:  # noqa: BLE001 - el health reporta, no falla
        return f"error: {error}"


def _verificar_postgres() -> str:
    """`no configurado` si el servicio aun no usa Postgres (sin driver)."""
    try:
        import psycopg2  # type: ignore
    except ImportError:
        return "no configurado"
    try:

        conexion = psycopg2.connect(  # noqa: F821 - importado arriba
            host=os.getenv("DB_HOST", "localhost"),
            port=int(os.getenv("DB_PORT", "5432")),
            user=os.getenv("DB_USER", "postgres"),
            password=os.getenv("DB_PASSWORD", "postgres"),
            dbname=os.getenv("DB_NAME", "retaildb"),
            connect_timeout=2,
        )
        with conexion.cursor() as cursor:
            cursor.execute("SELECT 1")
        conexion.close()
        return "ok"
    except Exception as error:  # noqa: BLE001
        return f"error: {error}"


@app.middleware("http")
async def negociar_xml(request: Request, call_next):
    """Si `Accept` pide XML, serializa el JSON a XML con la raiz del XSD.

    Cubre tambien las respuestas de error: el cliente de escritorio es
    XML-exclusivo, asi que un 401 en JSON no lo puede leer. El cuerpo de
    error usa la raiz `<error>` que declaran los XSD, y se le quita
    `details` porque seis de los siete esquemas no lo declaran.
    """
    respuesta = await call_next(request)
    if not quiere_xml(request.headers.get("accept")):
        return respuesta

    import json as _json
    cuerpo = b""
    async for fragmento in respuesta.body_iterator:
        cuerpo += fragmento
    try:
        datos = _json.loads(cuerpo or b"null")
    except ValueError:
        return respuesta

    es_error = respuesta.status_code >= 400
    if es_error:
        raiz, siempre = "error", ()
        if isinstance(datos, dict):
            datos = {k: v for k, v in datos.items() if k != "details"}
    else:
        raiz, siempre = _raiz_de(request.url.path)

    # La respuesta XML es nueva: sin copiar estas cabeceras se perdían los ids
    # que pone LoggingMiddleware (el cliente de escritorio no podría citarlos).
    ids = {k: v for k, v in respuesta.headers.items() if k.lower() in ("x-request-id", "x-correlation-id")}
    return Response(
        content=serializar_xml(datos, raiz, siempre),
        media_type=CONTENT_TYPE_XML,
        status_code=respuesta.status_code,
        headers=ids,
    )
