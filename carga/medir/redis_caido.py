"""Caída completa de Redis: cada servicio debe responder 503 controlado y recuperarse solo al volver.

SOLO LOCAL: detiene el contenedor de Redis (`docker stop`), así que corta la sesión de todo el ambiente.
En staging lo corre Juan Ángel en una ventana acordada (infra/staging/pruebas-de-fallos.md).

    python carga/medir/redis_caido.py carga/resultados/<corrida>

Pasos (con una sesión real por perfil, de `carga/.sesiones.json`):
  1. Línea base: una lectura por servicio debe dar su código normal.
  2. `docker stop` de Redis y la misma lectura: se espera `503` con `code: SERVICE_UNAVAILABLE`
     (SessionGuard, fail-closed; `commandTimeout` de 2 s en la plantilla). Un 401 o 500 es falla, y
     también un 503 que tarde más de 5 s. Además, un login debe dar 503 y no 500.
  3. `docker start` de Redis: se mide cuántos segundos tarda cada servicio en volver a su código normal
     sin reiniciarlo. Redis guarda RDB en su volumen: las sesiones sobreviven a la caída.

Escribe `<prefijo>_redis_caido.json` y `<prefijo>_redis_caido.md`.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import escenario as esc  # noqa: E402
import sesiones as ses  # noqa: E402
from destinos import Destino, Http  # noqa: E402

LIMITE_503_MS = 5000
ESPERA_RECUPERACION_S = 90

#: Servicios que en el escenario solo escriben: su lectura propia para la prueba.
EXTRA = [
    ('investigador', 'offline-sync-service', '/v1/sync/batches?limit=1', (200,)),
    ('gerente', 'recommendations-workflow-service', '/v1/workflow/assignments?limit=1', (200,)),
    ('administrador', 'auth-service', '/v1/usuarios?limit=1', (200,)),
]


def sondas(fx: esc.Fixtures) -> list[dict]:
    """Una lectura por servicio, con el perfil que la puede hacer (la primera del escenario)."""
    import random
    rng = random.Random(1)
    vistas, salida = set(), []
    for perfil, lecturas in esc.LECTURAS.items():
        for l in lecturas:
            if l.servicio in vistas:
                continue
            vistas.add(l.servicio)
            salida.append({'perfil': perfil, 'servicio': l.servicio, 'ruta': l.ruta(fx, rng), 'normal': l.esperados})
    for perfil, servicio, ruta, normal in EXTRA:
        if servicio not in vistas:
            vistas.add(servicio)
            salida.append({'perfil': perfil, 'servicio': servicio, 'ruta': ruta, 'normal': normal})
    return sorted(salida, key=lambda s: s['servicio'])


def veredicto_caida(estado: int | None, cuerpo, ms: float) -> str:
    """Con Redis caído: 503 controlado, a tiempo, con el código de error estándar."""
    if estado is None:
        return 'sin respuesta'
    if estado != 503:
        return f'{estado} (se esperaba 503)'
    if not isinstance(cuerpo, dict) or cuerpo.get('code') != 'SERVICE_UNAVAILABLE':
        return f"503 sin code SERVICE_UNAVAILABLE ({cuerpo.get('code') if isinstance(cuerpo, dict) else 'sin cuerpo'})"
    if ms > LIMITE_503_MS:
        return f'503 lento ({ms:.0f} ms > {LIMITE_503_MS})'
    return 'ok'


def pedir(http: Http, url: str, token: str | None, metodo='GET', cuerpo=None) -> tuple[int | None, object, float]:
    inicio = time.perf_counter()
    try:
        estado, datos, _ = http.pedir(metodo, url, cuerpo, token=token)
    except OSError:
        estado, datos = None, None
    return estado, datos, round((time.perf_counter() - inicio) * 1000, 1)


def docker(*args: str) -> None:
    subprocess.run(['docker', *args], check=True, capture_output=True)


def redis_listo(contenedor: str) -> bool:
    r = subprocess.run(['docker', 'exec', contenedor, 'redis-cli', 'ping'], capture_output=True, text=True)
    return r.stdout.strip() == 'PONG'


def markdown(r: dict) -> str:
    l = ['# Redis caído: 503 controlado y recuperación (local)', '',
         f"Login durante la caída: **{r['login']['estado']}** ({r['login']['veredicto']}). "
         f"Redis de vuelta en {r['redis_listo_s']} s.", '',
         '| Servicio | Ruta | Antes | Con Redis caído | ms | Veredicto | Recuperación s |', '|---|---|---|---|---|---|---|']
    for s in r['servicios']:
        l.append(f"| {s['servicio']} | `{s['ruta'][:60]}` | {s['antes']} | {s['caido']} | {s['caido_ms']} | "
                 f"{s['veredicto']} | {s['recuperacion_s'] if s['recuperacion_s'] is not None else 'no volvió'} |")
    ok = sum(1 for s in r['servicios'] if s['veredicto'] == 'ok')
    if r.get('no_probados'):
        l += ['', f"No probados (no estaban arriba en la línea base): {', '.join(r['no_probados'])}."]
    l += ['', f"{ok}/{len(r['servicios'])} servicios con 503 controlado; "
              f"{sum(1 for s in r['servicios'] if s['recuperacion_s'] is not None)} se recuperaron sin reiniciarse."]
    return '\n'.join(l) + '\n'


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description='Prueba de caída completa de Redis (solo local).')
    parser.add_argument('prefijo', type=Path)
    parser.add_argument('--redis', default='retail_redis')
    parser.add_argument('--solo-arriba', action='store_true',
                        help='Prueba solo los servicios que responden en la línea base (local con memoria limitada)')
    parser.add_argument('--sesiones', type=Path, default=ses.ARCHIVO)
    parser.add_argument('--fixtures', type=Path, default=Path(__file__).resolve().parents[1] / '.fixtures.json')
    args = parser.parse_args(argv)
    datos = ses.cargar(args.sesiones)
    if datos.get('base'):
        print('Solo local: estas sesiones son de un ambiente remoto. En staging la corre Juan Ángel.', file=sys.stderr)
        return 2
    destino, http = Destino(None), Http(timeout=20)
    fx = esc.Fixtures.desde(json.loads(args.fixtures.read_text(encoding='utf-8')))
    por_perfil = {}
    for i, s in enumerate(datos['sesiones']):
        if s['perfil'] not in por_perfil:
            if ses.necesita_renovar(s):
                s = datos['sesiones'][i] = ses.renovar(http, destino, s)
            por_perfil[s['perfil']] = s
    ses.guardar(datos['sesiones'], destino, args.sesiones)

    lista = sondas(fx)
    for s in lista:
        s['url'] = destino.url(s['servicio'], s['ruta'])
        s['token'] = por_perfil[s['perfil']]['accessToken']
        s['antes'] = pedir(http, s['url'], s['token'])[0]
    faltan = [s['servicio'] for s in lista if s['antes'] not in s['normal']]
    if faltan and not args.solo_arriba:
        print(f'Línea base incompleta: {faltan} no dan su código normal. Levántalos o usa --solo-arriba.', file=sys.stderr)
        return 1
    lista = [s for s in lista if s['servicio'] not in faltan]

    print('Deteniendo Redis…')
    docker('stop', args.redis)
    try:
        time.sleep(2)
        for s in lista:
            estado, cuerpo, ms = pedir(http, s['url'], s['token'])
            s.update({'caido': estado, 'caido_ms': ms, 'caido_code': cuerpo.get('code') if isinstance(cuerpo, dict) else None,
                      'veredicto': veredicto_caida(estado, cuerpo, ms)})
            print(f"  {s['servicio']:34} {estado} {ms:7.0f} ms  {s['veredicto']}")
        cuenta = por_perfil['administrador']
        estado, cuerpo, ms = pedir(http, destino.url('auth-service', '/v1/auth/login'), None, 'POST',
                                   {'email': cuenta['email'], 'password': 'no-se-envia-una-real'})
        login = {'estado': estado, 'ms': ms, 'veredicto': 'ok' if estado == 503 else f'{estado} (se esperaba 503)'}
    finally:
        print('Levantando Redis…')
        docker('start', args.redis)
    inicio = time.monotonic()
    while not redis_listo(args.redis):
        time.sleep(0.5)
    listo_s = round(time.monotonic() - inicio, 1)
    pendientes = {s['servicio']: s for s in lista}
    for s in lista:
        s['recuperacion_s'] = None
    while pendientes and time.monotonic() - inicio < ESPERA_RECUPERACION_S:
        for nombre, s in list(pendientes.items()):
            if pedir(http, s['url'], s['token'])[0] in s['normal']:
                s['recuperacion_s'] = round(time.monotonic() - inicio, 1)
                del pendientes[nombre]
        time.sleep(1)
    resultado = {'login': login, 'redis_listo_s': listo_s, 'no_probados': faltan,
                 'servicios': [{k: v for k, v in s.items() if k not in ('token', 'url')} for s in lista]}
    args.prefijo.parent.mkdir(parents=True, exist_ok=True)
    Path(f'{args.prefijo}_redis_caido.json').write_text(json.dumps(resultado, ensure_ascii=False, indent=1), encoding='utf-8')
    Path(f'{args.prefijo}_redis_caido.md').write_text(markdown(resultado), encoding='utf-8')
    malos = [s['servicio'] for s in lista if s['veredicto'] != 'ok' or s['recuperacion_s'] is None]
    print(f"Listo: {args.prefijo.name}_redis_caido.md; con problema: {malos or 'ninguno'}")
    return 0 if not malos and login['veredicto'] == 'ok' else 1


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.exit(main())
