"""Datos que usa la carga, leídos del ambiente por HTTP antes de medir (no cuenta en las estadísticas).

Escribe `carga/.fixtures.json` (fuera de git):
- zonas con su segmento (income-segmentation), tiendas y productos activos con sus presentaciones;
- una recomendación `aceptada` para las asignaciones del Gerente: reutiliza una que ya exista o la
  genera el Planeador y la aprueba el Gerente (decision-service, D-12). Si ninguna regla dispara,
  las asignaciones se saltan y se avisa.

    CARGA_SEED_PASSWORD=... python carga/preparar.py [--base https://<staging>]

Usa los usuarios del seed (Analista, Planeador, Gerente); su contraseña va por variable de entorno.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
from pathlib import Path

from destinos import Destino, Http

ARCHIVO = Path(__file__).resolve().parent / ".fixtures.json"
SEED = {'analista': 'analista@retail.mx', 'planeador': 'planeador@retail.mx', 'gerente': 'gercategoria@retail.mx'}


class ErrorPreparar(Exception):
    pass


def filas(cuerpo) -> list:
    """Listados paginados (`{data: [...]}`) o arreglos simples."""
    return cuerpo['data'] if isinstance(cuerpo, dict) and 'data' in cuerpo else cuerpo


def usuario_del_token(token: str) -> str:
    carga = token.split('.')[1]
    return json.loads(base64.urlsafe_b64decode(carga + '=' * (-len(carga) % 4)))['sub']


class Preparador:
    def __init__(self, http: Http, destino: Destino, password: str):
        self.http, self.destino, self.password = http, destino, password
        self.tokens: dict[str, str] = {}

    def token(self, quien: str) -> str:
        if quien not in self.tokens:
            estado, cuerpo, _ = self.http.pedir('POST', self.destino.url('auth-service', '/v1/auth/login'),
                                                {'email': SEED[quien], 'password': self.password})
            if estado != 200:
                raise ErrorPreparar(f'login de {SEED[quien]}: {estado} {cuerpo}')
            self.tokens[quien] = cuerpo['accessToken']
        return self.tokens[quien]

    def pedir(self, quien: str, metodo: str, servicio: str, ruta: str, cuerpo=None, esperados=(200,)):
        estado, r, _ = self.http.pedir(metodo, self.destino.url(servicio, ruta), cuerpo, token=self.token(quien))
        if estado not in esperados:
            raise ErrorPreparar(f'{metodo} {servicio} {ruta}: {estado} {r}')
        return r

    def todas(self, quien: str, servicio: str, ruta: str) -> list:
        salida, pagina = [], 1
        while True:
            r = self.pedir(quien, 'GET', servicio, f'{ruta}?limit=100&page={pagina}')
            salida += filas(r)
            if not isinstance(r, dict) or pagina * 100 >= r.get('total', 0):
                return salida
            pagina += 1

    def catalogo(self) -> dict:
        clasif = {c['zoneId']: c['segmentId'] for c in
                  filas(self.pedir('analista', 'GET', 'income-segmentation-service', '/v1/zone-classifications?limit=100'))}
        zonas = [{'id': z['id'], 'nombre': z['nombre'], 'segmentId': clasif.get(z['id'])}
                 for z in self.todas('analista', 'catalog-service', '/v1/zones')]
        tiendas = [{'id': t['id'], 'zonaId': t.get('zonaId') or (t.get('zona') or {}).get('id')}
                   for t in self.todas('analista', 'catalog-service', '/v1/stores')]
        productos = []
        for p in self.todas('analista', 'catalog-service', '/v1/products'):
            if p.get('estatus', 'activo') != 'activo':
                continue
            pres = [x['id'] for x in filas(self.pedir('analista', 'GET', 'catalog-service',
                                                       f"/v1/products/{p['id']}/presentations"))
                    if x.get('activo', True)]
            if pres:
                productos.append({'id': p['id'], 'sku': p['sku'], 'presentaciones': pres})
        if not zonas or not tiendas or not productos:
            raise ErrorPreparar(f'Catálogo vacío ({len(zonas)} zonas, {len(tiendas)} tiendas, {len(productos)} '
                                'productos): carga antes los datos del generador.')
        return {'zonas': zonas, 'tiendas': tiendas, 'productos': productos}

    def recomendacion(self) -> str | None:
        """Una recomendación `aceptada`: la que ya exista o una nueva (Planeador genera, Gerente aprueba)."""
        for r in filas(self.pedir('gerente', 'GET', 'decision-service', '/v1/recommendations?limit=100')):
            if r.get('status') == 'aceptada':
                return r.get('recommendationId') or r.get('id')
        nuevas = self.pedir('planeador', 'POST', 'decision-service', '/v1/recommendations/generate', {},
                            esperados=(200, 201))
        if not nuevas:
            return None
        rid = nuevas[0].get('recommendationId') or nuevas[0].get('id')
        self.pedir('gerente', 'PATCH', 'decision-service', f'/v1/recommendations/{rid}/approve')
        return rid


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Lee del ambiente los ids que usa la carga.')
    parser.add_argument('--base', default=None)
    parser.add_argument('--salida', type=Path, default=ARCHIVO)
    args = parser.parse_args(argv)
    password = os.getenv('CARGA_SEED_PASSWORD')
    if not password:
        print('Falta CARGA_SEED_PASSWORD (contraseña de los usuarios del seed).', file=sys.stderr)
        return 2
    destino = Destino(args.base)
    p = Preparador(Http(timeout=60), destino, password)
    try:
        datos = p.catalogo()
        datos['recomendacion'] = p.recomendacion()
        datos['responsable'] = usuario_del_token(p.token('planeador'))
    except ErrorPreparar as e:
        print(f'ERROR: {e}', file=sys.stderr)
        return 1
    args.salida.write_text(json.dumps({'destino': str(destino), **datos}, ensure_ascii=False, indent=1),
                           encoding='utf-8')
    print(f"Listo en {destino}: {len(datos['zonas'])} zonas ({sum(1 for z in datos['zonas'] if z['segmentId'])} "
          f"clasificadas), {len(datos['tiendas'])} tiendas, {len(datos['productos'])} productos.")
    if not datos['recomendacion']:
        print('  AVISO: ninguna regla generó recomendaciones: el Gerente no hará asignaciones.')
    return 0


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.exit(main())
