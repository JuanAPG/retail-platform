"""Cuentas sintéticas por rol para la carga: "usuarios distintos por sesión y roles reales" (guía).

El seed trae un usuario por rol; la carga necesita varios por perfil para que cada usuario virtual
tenga su propia sesión. Se crean con la API de auth-service (`POST /v1/usuarios`, Administrador),
nunca escribiendo en la base. Idempotente: las que ya existen se reutilizan.

    CARGA_ADMIN_PASSWORD=... CARGA_PASSWORD=... python carga/usuarios_carga.py --por-perfil 12
    ... --base https://<staging>      # detrás del proxy: /api/<servicio>

Las contraseñas van por variable de entorno, nunca en el repo. Si un rol no existe en el ambiente
(p. ej. una base local sembrada antes de D-28), ese perfil se reporta y se salta.
"""
from __future__ import annotations

import argparse
import os
import re
import sys

from destinos import Destino, Http

#: Perfil de la guía → rol real que lo ejerce (Matriz §3).
PERFILES = {
    "catalogo": "Responsable de precios",       # lectura de catálogo y precios
    "investigador": "Investigador de mercado",  # capturas de campo y sincronización (D-28)
    "analista": "Analista comercial",           # importa o consulta corridas
    "gerente": "Gerente de categoría",          # genera y descarga reportes
    "administrador": "Administrador",           # consulta monitoreo
}
DOMINIO = "retail-carga.test"
#: Mismas reglas que `CreateUsuarioDto` de auth-service.
_PASSWORD = re.compile(r"^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$")


def correo(perfil: str, n: int) -> str:
    return f"carga.{perfil}.{n:02d}@{DOMINIO}"


def cuentas(por_perfil: int, perfiles=PERFILES) -> list[dict]:
    """Las cuentas esperadas, en orden estable: mismo número, mismos correos (repetible)."""
    return [{"perfil": p, "rol": rol, "email": correo(p, n)} for p, rol in perfiles.items()
            for n in range(1, por_perfil + 1)]


class ErrorCarga(Exception):
    pass


def _esperar(estado: int, esperado: tuple, cuerpo, que: str) -> None:
    if estado not in esperado:
        raise ErrorCarga(f"{que}: respondió {estado}: {cuerpo}")


def entrar(http: Http, destino: Destino, email: str, password: str) -> dict:
    estado, cuerpo, _ = http.pedir("POST", destino.url("auth-service", "/v1/auth/login"),
                                   {"email": email, "password": password})
    _esperar(estado, (200,), cuerpo, f"login de {email}")
    return cuerpo


def existentes(http: Http, destino: Destino, token: str) -> dict[str, dict]:
    """Correo → usuario, recorriendo todas las páginas de `GET /v1/usuarios`."""
    salida, pagina = {}, 1
    while True:
        estado, cuerpo, _ = http.pedir("GET", destino.url("auth-service", f"/v1/usuarios?page={pagina}&limit=100"),
                                       token=token)
        _esperar(estado, (200,), cuerpo, "GET /v1/usuarios")
        salida.update({u["email"].lower(): u for u in cuerpo["data"]})
        if pagina * 100 >= cuerpo["total"]:
            return salida
        pagina += 1


def roles(http: Http, destino: Destino, token: str) -> dict[str, int]:
    estado, cuerpo, _ = http.pedir("GET", destino.url("auth-service", "/v1/roles"), token=token)
    _esperar(estado, (200,), cuerpo, "GET /v1/roles")
    filas = cuerpo["data"] if isinstance(cuerpo, dict) else cuerpo
    return {r["nombre"]: r["id"] for r in filas}


def asegurar(http: Http, destino: Destino, token: str, por_perfil: int, password: str) -> dict:
    """Crea las cuentas que falten. Devuelve el resumen por perfil y los roles que no existen."""
    if not _PASSWORD.match(password):
        raise ErrorCarga("CARGA_PASSWORD debe tener 8+ caracteres con mayúscula, minúscula y número.")
    rol_id = roles(http, destino, token)
    ya = existentes(http, destino, token)
    resumen = {p: {"creadas": 0, "existentes": 0} for p in PERFILES}
    faltan_roles = sorted({c["rol"] for c in cuentas(por_perfil) if c["rol"] not in rol_id})
    for c in cuentas(por_perfil):
        if c["rol"] not in rol_id:
            continue
        if c["email"] in ya:
            resumen[c["perfil"]]["existentes"] += 1
            continue
        perfil, n = c["perfil"], c["email"].split(".")[2].split("@")[0]
        estado, cuerpo, _ = http.pedir("POST", destino.url("auth-service", "/v1/usuarios"), {
            "nombre": f"Carga {perfil} {n}", "email": c["email"], "password": password,
            "rolId": rol_id[c["rol"]], "activo": True}, token=token)
        if estado == 409:  # otro proceso la creó entre la lectura y el alta
            resumen[perfil]["existentes"] += 1
            continue
        _esperar(estado, (201,), cuerpo, f"alta de {c['email']}")
        resumen[perfil]["creadas"] += 1
    return {"perfiles": resumen, "rolesFaltantes": faltan_roles}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Crea las cuentas sintéticas de la carga (idempotente).")
    parser.add_argument("--base", default=None, help="Base del proxy (staging/VM). Sin ella: local por puertos.")
    parser.add_argument("--por-perfil", type=int, default=12)
    parser.add_argument("--admin", default="admin@retail.mx")
    args = parser.parse_args(argv)
    admin_password, password = os.getenv("CARGA_ADMIN_PASSWORD"), os.getenv("CARGA_PASSWORD")
    if not admin_password or not password:
        print("Faltan CARGA_ADMIN_PASSWORD y CARGA_PASSWORD (variables de entorno).", file=sys.stderr)
        return 2
    destino, http = Destino(args.base), Http()
    try:
        token = entrar(http, destino, args.admin, admin_password)["accessToken"]
        r = asegurar(http, destino, token, args.por_perfil, password)
    except ErrorCarga as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    print(f"Cuentas de carga en {destino} ({args.por_perfil} por perfil):")
    for perfil, n in r["perfiles"].items():
        print(f"  {perfil:14} {PERFILES[perfil]:26} creadas {n['creadas']:3}  existentes {n['existentes']:3}")
    if r["rolesFaltantes"]:
        print(f"  AVISO: no existen en este ambiente los roles {r['rolesFaltantes']}: esos perfiles no correrán.")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
