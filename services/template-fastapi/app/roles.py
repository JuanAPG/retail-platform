"""Roles y permisos por ruta (Matriz §3).

Nombres EXACTOS como están sembrados en la tabla `roles` (`db/data_retail.sql`):
copia de `services/template-nest/src/common/roles.ts`. Si ahí cambia, aquí
también, y al revés; además se actualiza `docs/matriz-perfiles-permisos.md` y
se avisa al equipo.

Esta es la copia de la plantilla: un servicio FastAPI nuevo arranca con este
archivo y usa `requiere_roles(...)` como dependencia de ruta.
"""
from fastapi import Depends, HTTPException

from .auth_session import sesion_actual


class ROL:
    ADMINISTRADOR = "Administrador"
    ANALISTA = "Analista comercial"
    GERENTE_CATEGORIA = "Gerente de categoría"
    RESPONSABLE_PRECIOS = "Responsable de precios"
    PLANEADOR = "Planeador"
    AUDITOR = "Auditor"
    PROVEEDOR = "Proveedor"
    #: D-28: usuario de la app móvil. NO va en PERFILES_INTERNOS: esa lista abre
    #: lecturas (recomendaciones, escenarios, bitácora) que D-28 no le da. Se
    #: nombra explícitamente en cada ruta que sí lo acepta.
    INVESTIGADOR = "Investigador de mercado"


#: Los seis perfiles internos "de oficina". El Proveedor (externo) y el
#: Investigador de mercado (campo, D-28) quedan fuera a propósito: cada uno se
#: nombra ruta por ruta.
PERFILES_INTERNOS = (
    ROL.ADMINISTRADOR,
    ROL.ANALISTA,
    ROL.GERENTE_CATEGORIA,
    ROL.RESPONSABLE_PRECIOS,
    ROL.PLANEADOR,
    ROL.AUDITOR,
)


def requiere_roles(*roles: str):
    """Dependencia de ruta: sesión válida (JWT + Redis) y uno de `roles`.

    Equivale a `@UseGuards(SessionGuard, RolesGuard)` + `@Roles(...)` de Nest:
    sin sesión → 401 (lo resuelve `sesion_actual`); otro rol → 403.
    """
    async def verificar(usuario: dict = Depends(sesion_actual)) -> dict:
        if usuario.get("rol") not in roles:
            raise HTTPException(status_code=403, detail="Tu rol no tiene permiso para esta operación.")
        return usuario

    verificar.roles = roles  # Para que las pruebas lean qué exige cada ruta.
    return verificar
