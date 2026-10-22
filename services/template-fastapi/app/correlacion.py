"""Id de correlación (T-02) — NO CAMBIAR el nombre de la cabecera.

Espejo de `template-nest/src/common/correlation/correlacion.ts`. Una
operación de punta a punta comparte UN `X-Correlation-Id`: llega en la
cabecera o se genera aquí, se devuelve en la respuesta, va en cada línea de
log y se reenvía en cada llamada a otro servicio (`con_correlacion`).
`x-request-id` sigue identificando una sola petición.
"""
from __future__ import annotations

import re
import uuid
from contextvars import ContextVar

CABECERA_CORRELACION = "x-correlation-id"

#: Letras, dígitos y `._:-`, hasta 100. Otra cosa se reemplaza por un id
#: nuevo para que nadie inyecte texto en los logs ni en la bitácora.
_VALIDO = re.compile(r"^[A-Za-z0-9._:-]{1,100}$")

_actual: ContextVar[str | None] = ContextVar("correlacion", default=None)


def id_de_correlacion(entrante: str | None) -> str:
    """El id que trae la petición si es válido; si no, uno nuevo."""
    return entrante if entrante and _VALIDO.fullmatch(entrante) else str(uuid.uuid4())


def correlacion_actual() -> str | None:
    """El id de la operación en curso, o None fuera de una petición."""
    return _actual.get()


def con_correlacion(cabeceras: dict[str, str] | None = None) -> dict[str, str]:
    """Cabeceras para llamar a otro servicio con el mismo id.

    Uso: `httpx.get(url, headers=con_correlacion({"Authorization": token}))`.
    """
    salida = dict(cabeceras or {})
    actual = _actual.get()
    if actual:
        salida[CABECERA_CORRELACION] = actual
    return salida


def fijar(id_correlacion: str):
    """Abre el contexto de una operación; devuelve el token para `soltar`."""
    return _actual.set(id_correlacion)


def soltar(token) -> None:
    _actual.reset(token)
