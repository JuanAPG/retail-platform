"""Sesiones previas a la carga, respetando el límite de login de auth-service.

auth-service limita el login a 15 intentos por minuto por IP (`AUTH_LOGIN_MAX_ATTEMPTS`,
`AUTH_LOGIN_WINDOW_SECONDS`). Locust corre desde una sola máquina: si 50 usuarios virtuales entran
al arrancar, del 16 en adelante reciben 429 y la medición se contamina. Por eso las sesiones se
abren ANTES, a 14 por minuto, y se guardan; los usuarios de Locust las toman y las renuevan con
`POST /v1/auth/refresh` (que no tiene ese límite) antes de que venza el access token (15 min).

    CARGA_PASSWORD=... python carga/sesiones.py --por-perfil 12 [--base https://<staging>]

El archivo de salida lleva tokens: queda fuera de git (`carga/.sesiones.json`).
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time
from pathlib import Path

from destinos import Destino, Http
from usuarios_carga import PERFILES, cuentas

#: 15 por minuto es el límite; 14 deja margen para un reintento sin tocarlo.
LOGINS_POR_MINUTO = 14
RITMO_S = 60 / LOGINS_POR_MINUTO
#: Renueva si al access token le queda menos que esto.
MARGEN_RENOVACION_S = 120
ARCHIVO = Path(__file__).resolve().parent / ".sesiones.json"


class Reloj:
    """Separado para poder probar el ritmo sin esperar de verdad."""

    def ahora(self) -> float:
        return time.monotonic()

    def dormir(self, segundos: float) -> None:
        time.sleep(segundos)


def vence_en(token: str, ahora_epoch: float | None = None) -> float:
    """Segundos que le quedan a un JWT (lee `exp` sin verificar la firma: solo para decidir renovar)."""
    carga = token.split(".")[1]
    datos = json.loads(base64.urlsafe_b64decode(carga + "=" * (-len(carga) % 4)))
    return datos["exp"] - (time.time() if ahora_epoch is None else ahora_epoch)


def iniciar(http: Http, destino: Destino, lista: list[dict], password: str, reloj: Reloj | None = None,
            avisar=print) -> dict:
    """Login de cada cuenta a ≤ 14 por minuto. Un 429 se respeta (Retry-After) y se cuenta aparte."""
    reloj = reloj or Reloj()
    sesiones, rechazos_429, fallidas = [], 0, []
    ultimo = None
    for i, c in enumerate(lista):
        while True:
            if ultimo is not None:
                espera = RITMO_S - (reloj.ahora() - ultimo)
                if espera > 0:
                    reloj.dormir(espera)
            ultimo = reloj.ahora()
            estado, cuerpo, cabeceras = http.pedir("POST", destino.url("auth-service", "/v1/auth/login"),
                                                   {"email": c["email"], "password": password})
            if estado == 429:
                rechazos_429 += 1
                reloj.dormir(float(cabeceras.get("Retry-After") or cabeceras.get("retry-after") or 60))
                continue
            break
        if estado != 200:
            fallidas.append({"email": c["email"], "status": estado, "motivo": cuerpo})
            continue
        sesiones.append({**c, "accessToken": cuerpo["accessToken"], "refreshToken": cuerpo["refreshToken"]})
        avisar(f"  {i + 1}/{len(lista)} {c['email']}")
    return {"sesiones": sesiones, "rechazos429": rechazos_429, "fallidas": fallidas}


def renovar(http: Http, destino: Destino, sesion: dict) -> dict:
    """`POST /v1/auth/refresh`: devuelve la sesión con tokens nuevos (rota también el refresh)."""
    estado, cuerpo, _ = http.pedir("POST", destino.url("auth-service", "/v1/auth/refresh"),
                                   {"refreshToken": sesion["refreshToken"]})
    if estado != 200:
        raise RuntimeError(f"refresh de {sesion['email']}: {estado} {cuerpo}")
    return {**sesion, "accessToken": cuerpo["accessToken"], "refreshToken": cuerpo["refreshToken"]}


def necesita_renovar(sesion: dict, margen_s: float = MARGEN_RENOVACION_S) -> bool:
    return vence_en(sesion["accessToken"]) < margen_s


def guardar(sesiones: list[dict], destino: Destino, archivo: Path = ARCHIVO) -> None:
    archivo.write_text(json.dumps({"destino": str(destino), "base": destino.base, "sesiones": sesiones},
                                  ensure_ascii=False, indent=1), encoding="utf-8")


def cargar(archivo: Path = ARCHIVO) -> dict:
    return json.loads(archivo.read_text(encoding="utf-8"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Abre las sesiones de la carga a ≤ 14 logins por minuto.")
    parser.add_argument("--base", default=None)
    parser.add_argument("--por-perfil", type=int, default=12)
    parser.add_argument("--perfiles", default=",".join(PERFILES), help="Perfiles separados por coma.")
    parser.add_argument("--salida", type=Path, default=ARCHIVO)
    args = parser.parse_args(argv)
    password = os.getenv("CARGA_PASSWORD")
    if not password:
        print("Falta CARGA_PASSWORD (variable de entorno).", file=sys.stderr)
        return 2
    elegidos = {p: PERFILES[p] for p in args.perfiles.split(",")}
    lista = cuentas(args.por_perfil, elegidos)
    destino = Destino(args.base)
    print(f"Abriendo {len(lista)} sesiones en {destino} a {LOGINS_POR_MINUTO}/min "
          f"(~{len(lista) * RITMO_S / 60:.1f} min)…")
    r = iniciar(Http(), destino, lista, password)
    guardar(r["sesiones"], destino, args.salida)
    print(f"Listo: {len(r['sesiones'])} sesiones en {args.salida.name}; 429 respetados: {r['rechazos429']}; "
          f"fallidas: {len(r['fallidas'])}")
    for f in r["fallidas"]:
        print(f"  {f['email']}: {f['status']} {f['motivo']}")
    return 0 if not r["fallidas"] else 1


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
