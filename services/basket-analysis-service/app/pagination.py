"""Paginación estándar — NO CAMBIAR sus nombres ni defaults.
Espejo exacto del DTO Nest (`pagination.dto.ts`):
`?page=2&limit=20`, envoltura `{data, total, page, limit}`.

Uso con SQLAlchemy 2.0 (select + func.count) o con cualquier secuencia:
    pagina = paginar(filtros.page, filtros.limit, total, filas)
"""
from dataclasses import dataclass
from typing import Generic, TypeVar

PAGINA_DEFAULT = 1
LIMITE_DEFAULT = 20
LIMITE_MAXIMO = 100

T = TypeVar("T")


@dataclass
class Pagina(Generic[T]):
    data: list[T]
    total: int
    page: int
    limit: int


def normalizar(page: int | None, limit: int | None) -> tuple[int, int]:
    """Valida y acota (limit mayor a 100 se recorta). `page` fuera de rango
    lo resuelve el llamador con `data: []`."""
    pagina = PAGINA_DEFAULT if page is None else page
    if pagina < 1:
        raise ValueError("page debe ser mayor a 0.")
    filas = LIMITE_DEFAULT if limit is None else limit
    if filas < 1:
        raise ValueError("limit debe ser mayor a 0.")
    return pagina, min(filas, LIMITE_MAXIMO)


def paginar(page: int | None, limit: int | None, total: int, filas: list[T]) -> Pagina[T]:
    pagina, tope = normalizar(page, limit)
    return Pagina(data=list(filas), total=total, page=pagina, limit=tope)


def desplazamiento(page: int | None, limit: int | None) -> tuple[int, int]:
    """`(offset, limit)` listos para `query.offset().limit()`."""
    pagina, tope = normalizar(page, limit)
    return (pagina - 1) * tope, tope
