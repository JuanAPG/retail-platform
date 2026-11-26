"""Carga los datos del generador del Parcial 3 por los servicios, con usuarios reales.

Nunca toca la base a mano: todo pasa por HTTP con el permiso de la Matriz.
  1. catalog-service (Administrador): la zona chica y las tiendas nuevas.
  2. income-segmentation-service (Analista comercial): clasifica la zona nueva con su segmento.
  3. catalog-service (Gerente de categoría): categorías, productos y presentaciones.
  4. core-process-service (Analista comercial): cada ventas-*.csv por la importación CSV
     (vista previa + confirmación). El importador acepta hasta 5 MB por archivo y, mientras la
     vista previa guarde el staging en un solo INSERT, hasta 4,095 líneas; el generador parte
     los archivos por debajo de los dos topes (`--max-mb`, `--max-lineas`).

Idempotente: lo que ya existe se reutiliza. Reimportar un archivo ya confirmado responde 409 en
core-process y aquí se salta; uno validado que quedó a medias se vuelve a confirmar (core-process
retoma solo lo pendiente). Uno que quedó con errores detiene la carga: confirmarlo metería solo
una parte de sus ventas. Correrlo dos veces no duplica ventas.

Mide cada paso y escribe `manifiesto-carga.json` junto a los datos.

Uso:
  python db/cargar_datos_parcial3.py --datos db/generados/10000
  python db/cargar_datos_parcial3.py --datos db/generados/10000 --solo-catalogo
Requiere arriba: auth, catalog, income-segmentation y core-process (y Redis/Postgres).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path

LIMITE_LINEAS_CORE = 65535 // 16  # parámetros de Postgres por consulta / valores por línea del staging
INTENTOS_CONFIRMACION = 3


class ErrorDeCarga(Exception):
    pass


class Cliente:
    """HTTP con un token por rol; si el token vence (15 min) a media carga, vuelve a entrar."""

    def __init__(self, urls: dict[str, str], usuarios: dict[str, str], password: str, timeout: float):
        self.urls, self.usuarios, self.password, self.timeout = urls, usuarios, password, timeout
        self.tokens: dict[str, str] = {}
        self.correlacion = f'generador-{uuid.uuid4()}'

    def entrar(self, rol: str) -> str:
        estado, cuerpo = self._enviar('POST', f"{self.urls['auth']}/v1/auth/login",
                                      {'email': self.usuarios[rol], 'password': self.password}, None)
        if estado != 200:
            raise ErrorDeCarga(f'No se pudo entrar como {rol} ({self.usuarios[rol]}): {estado} {cuerpo}')
        self.tokens[rol] = cuerpo['accessToken']
        return self.tokens[rol]

    def pedir(self, rol: str, metodo: str, servicio: str, ruta: str, cuerpo=None, archivo: Path | None = None):
        url = f'{self.urls[servicio]}{ruta}'
        token = self.tokens.get(rol) or self.entrar(rol)
        estado, respuesta = self._enviar(metodo, url, cuerpo, token, archivo)
        if estado == 401:  # token vencido o sesión cerrada: una sola vez más
            estado, respuesta = self._enviar(metodo, url, cuerpo, self.entrar(rol), archivo)
        return estado, respuesta

    def _enviar(self, metodo, url, cuerpo, token, archivo=None):
        encabezados = {'Accept': 'application/json', 'X-Correlation-Id': self.correlacion}
        if token:
            encabezados['Authorization'] = f'Bearer {token}'
        datos = None
        if archivo is not None:
            frontera = f'----generador{uuid.uuid4().hex}'
            datos = (f'--{frontera}\r\nContent-Disposition: form-data; name="file"; filename="{archivo.name}"\r\n'
                     f'Content-Type: text/csv\r\n\r\n').encode() + archivo.read_bytes() + f'\r\n--{frontera}--\r\n'.encode()
            encabezados['Content-Type'] = f'multipart/form-data; boundary={frontera}'
        elif cuerpo is not None:
            datos = json.dumps(cuerpo).encode()
            encabezados['Content-Type'] = 'application/json'
        peticion = urllib.request.Request(url, data=datos, method=metodo, headers=encabezados)
        try:
            with urllib.request.urlopen(peticion, timeout=self.timeout) as r:
                texto = r.read().decode('utf-8')
                return r.status, json.loads(texto) if texto else None
        except urllib.error.HTTPError as e:
            texto = e.read().decode('utf-8', 'replace')
            try:
                return e.code, json.loads(texto)
            except json.JSONDecodeError:
                return e.code, texto
        except urllib.error.URLError as e:
            raise ErrorDeCarga(f'{url} no responde: {e.reason}') from e

    def todas(self, rol: str, servicio: str, ruta: str) -> list[dict]:
        """Recorre un listado paginado completo (`paginacion.md`)."""
        filas, pagina = [], 1
        separador = '&' if '?' in ruta else '?'
        while True:
            estado, r = self.pedir(rol, 'GET', servicio, f'{ruta}{separador}limit=100&page={pagina}')
            esperar(estado, 200, r, f'GET {ruta}')
            filas.extend(r['data'])
            if pagina * 100 >= r['total']:
                return filas
            pagina += 1


def esperar(estado: int, esperado: int | tuple, cuerpo, que: str) -> None:
    if estado not in (esperado if isinstance(esperado, tuple) else (esperado,)):
        raise ErrorDeCarga(f'{que}: respondió {estado}: {cuerpo}')


class Cargador:
    def __init__(self, cliente: Cliente, datos: Path):
        self.c = cliente
        self.datos = datos
        self.catalogo = json.loads((datos / 'catalogo.json').read_text(encoding='utf-8'))
        self.manifiesto = json.loads((datos / 'manifiesto.json').read_text(encoding='utf-8'))
        self.registro: dict = {'pasos': {}, 'archivos': []}

    def medir(self, paso: str, funcion):
        inicio = time.perf_counter()
        resultado = funcion()
        self.registro['pasos'][paso] = {'segundos': round(time.perf_counter() - inicio, 2), **(resultado or {})}
        print(f'  {paso}: {self.registro["pasos"][paso]}')

    # --- 1 y 2: zonas y su clasificación

    def zonas(self) -> dict:
        existentes = {z['nombre']: z for z in self.c.todas('admin', 'catalog', '/v1/zones')}
        estado, municipios = self.c.pedir('admin', 'GET', 'catalog', '/v1/municipalities')
        esperar(estado, 200, municipios, 'GET /v1/municipalities')
        municipio_id = {m['nombre']: m['id'] for m in municipios}
        estado, segmentos = self.c.pedir('analista', 'GET', 'segmentacion', '/v1/segments?limit=100')
        esperar(estado, 200, segmentos, 'GET /v1/segments')
        segmento_id = {s['code']: s['id'] for s in segmentos['data']}
        creadas, clasificadas = 0, 0
        for z in self.catalogo['zonas']:
            if z['nombre'] not in existentes:
                estado, r = self.c.pedir('admin', 'POST', 'catalog', '/v1/zones',
                                         {'nombre': z['nombre'], 'municipioId': municipio_id[z['municipio']],
                                          'descripcion': 'Zona de prueba del generador del Parcial 3 (D-36).'})
                esperar(estado, 201, r, f"POST /v1/zones {z['nombre']}")
                existentes[z['nombre']] = r
                creadas += 1
            zona_id = existentes[z['nombre']]['id']
            estado, actual = self.c.pedir('analista', 'GET', 'segmentacion', f'/v1/zones/{zona_id}/classification')
            if estado == 404:
                estado, r = self.c.pedir('analista', 'PUT', 'segmentacion', f'/v1/zones/{zona_id}/classification',
                                         {'segmentId': segmento_id[z['segmento']]})
                esperar(estado, 200, r, f"PUT clasificación {z['nombre']}")
                clasificadas += 1
            elif estado == 200 and actual['segmentCode'] != z['segmento']:
                print(f"  aviso: {z['nombre']} está clasificada como {actual['segmentCode']}, "
                      f"el generador supone {z['segmento']}; no se cambia.")
            else:
                esperar(estado, 200, actual, f"GET clasificación {z['nombre']}")
        self.zona_id = {n: z['id'] for n, z in existentes.items()}
        self.municipio_de_zona = {z['nombre']: municipio_id[z['municipio']] for z in self.catalogo['zonas']}
        return {'creadas': creadas, 'clasificadas': clasificadas}

    # --- 1: tiendas

    def tiendas(self) -> dict:
        existentes = {t['nombre'] for t in self.c.todas('admin', 'catalog', '/v1/stores')}
        estado, codigos = self.c.pedir('admin', 'GET', 'catalog', '/v1/stores/catalog/postal-codes')
        esperar(estado, 200, codigos, 'GET postal-codes')
        cp_de_municipio = {}
        for cp in codigos:
            cp_de_municipio.setdefault(cp['municipioId'], cp['codigoPostal'])
        creadas = 0
        for i, t in enumerate(self.catalogo['tiendas']):
            if t['nombre'] in existentes:
                continue
            estado, r = self.c.pedir('admin', 'POST', 'catalog', '/v1/stores', {
                'nombre': t['nombre'], 'formato': t['formato'], 'zonaId': self.zona_id[t['zona']],
                'numeroSucursal': t['numeroSucursal'], 'calle': 'Av. del Generador', 'numeroExterior': str(100 + i),
                'codigoPostal': cp_de_municipio[self.municipio_de_zona[t['zona']]]})
            esperar(estado, 201, r, f"POST /v1/stores {t['nombre']}")
            creadas += 1
        return {'creadas': creadas, 'total': len(self.catalogo['tiendas'])}

    # --- 3: categorías, productos y presentaciones

    def productos(self) -> dict:
        estado, categorias = self.c.pedir('gerente', 'GET', 'catalog', '/v1/product-categories')
        esperar(estado, 200, categorias, 'GET /v1/product-categories')
        categoria_id = {c['nombre']: c['id'] for c in categorias}
        nuevas_cat = 0
        for c in self.catalogo['categorias']:
            if c['nombre'] not in categoria_id:
                estado, r = self.c.pedir('gerente', 'POST', 'catalog', '/v1/product-categories', {'nombre': c['nombre']})
                esperar(estado, 201, r, f"POST categoría {c['nombre']}")
                categoria_id[c['nombre']] = r['id']
                nuevas_cat += 1
        nuevos, nuevas_pres = 0, 0
        for p in self.catalogo['productos']:
            q = urllib.parse.quote(p['sku'])
            estado, r = self.c.pedir('gerente', 'GET', 'catalog', f'/v1/products?search={q}&limit=100')
            esperar(estado, 200, r, f"GET producto {p['sku']}")
            existente = next((x for x in r['data'] if x['sku'] == p['sku']), None)
            primera = p['presentaciones'][0]
            if existente is None:
                estado, existente = self.c.pedir('gerente', 'POST', 'catalog', '/v1/products', {
                    'sku': p['sku'], 'nombre': p['nombre'], 'categoriaId': categoria_id[p['categoria']],
                    'esCanastaBasica': p['esCanastaBasica'], 'presentacion': primera['nombre'],
                    'contenido': primera['contenido'], 'unidadMedida': primera['unidadMedida'],
                    'descripcion': 'Producto del generador del Parcial 3.'})
                esperar(estado, 201, existente, f"POST /v1/products {p['sku']}")
                nuevos += 1
            estado, presentaciones = self.c.pedir('gerente', 'GET', 'catalog',
                                                  f"/v1/products/{existente['id']}/presentations")
            esperar(estado, 200, presentaciones, f"GET presentaciones {p['sku']}")
            nombres = {x['nombre'] for x in presentaciones}
            for pres in p['presentaciones']:
                if pres['nombre'] in nombres:
                    continue
                estado, r = self.c.pedir('gerente', 'POST', 'catalog', f"/v1/products/{existente['id']}/presentations",
                                         {'nombre': pres['nombre'], 'contenido': pres['contenido'],
                                          'unidadMedida': pres['unidadMedida']})
                esperar(estado, 201, r, f"POST presentación {p['sku']} {pres['nombre']}")
                nuevas_pres += 1
        return {'categoriasNuevas': nuevas_cat, 'productosNuevos': nuevos, 'presentacionesNuevas': nuevas_pres,
                'productos': len(self.catalogo['productos'])}

    # --- 4: ventas

    def transacciones_en_core(self) -> int:
        estado, r = self.c.pedir('analista', 'GET', 'core', '/v1/transactions?limit=1')
        esperar(estado, 200, r, 'GET /v1/transactions')
        return r['total']

    def importar(self, entrada: dict) -> dict:
        archivo = self.datos / entrada['archivo']
        if hashlib.sha256(archivo.read_bytes()).hexdigest() != entrada['sha256']:
            raise ErrorDeCarga(f"{archivo.name} no coincide con el manifiesto (SHA-256): regenera los datos.")
        fila = {'archivo': archivo.name, 'transacciones': entrada['transacciones'], 'lineas': entrada['lineas'],
                'bytes': entrada['bytes']}
        inicio = time.perf_counter()
        estado, r = self.c.pedir('analista', 'POST', 'core', '/v1/transactions/import/preview', archivo=archivo)
        fila['previewSegundos'] = round(time.perf_counter() - inicio, 2)
        if estado == 409:
            # Mismo archivo (mismo SHA-256) ya subido: core-process dice cuál importación y en qué estado.
            m = re.search(r'importación ([0-9a-f-]{36}), estado (\w+)', str(r))
            if not m:
                raise ErrorDeCarga(f'{archivo.name}: 409 inesperado: {r}')
            importacion, estado_previo = m.groups()
            if estado_previo == 'confirmado':
                return {**fila, 'resultado': 'ya cargado', 'importacionId': importacion}
            if estado_previo != 'validado':
                raise ErrorDeCarga(f'{archivo.name}: ya se subió como importación {importacion} en estado '
                                   f'{estado_previo}; descártala (DELETE /v1/transactions/import/{importacion}) '
                                   'y vuelve a correr.')
        elif estado == 500 and entrada['lineas'] > LIMITE_LINEAS_CORE:
            raise ErrorDeCarga(f"{archivo.name}: 500 en la vista previa con {entrada['lineas']} líneas; core-process "
                               f'guarda el staging en un solo INSERT y no pasa de {LIMITE_LINEAS_CORE}. Regenera con '
                               '--max-lineas 4000.')
        else:
            esperar(estado, 201, r, f'preview {archivo.name}')
            if r['filasConError']:
                raise ErrorDeCarga(f"{archivo.name}: {r['filasConError']} filas con error, p. ej. {r['errores'][:3]}")
            importacion = r['importacionId']
        inicio = time.perf_counter()
        for _ in range(INTENTOS_CONFIRMACION):  # la confirmación es reanudable: se repite si quedó incompleta
            estado, r = self.c.pedir('analista', 'POST', 'core', '/v1/transactions/import/confirm',
                                     {'previewId': importacion})
            esperar(estado, 200, r, f'confirm {archivo.name}')
            if r.get('completa', True):
                break
        else:
            raise ErrorDeCarga(f"{archivo.name}: la importación {importacion} sigue incompleta tras "
                               f"{INTENTOS_CONFIRMACION} confirmaciones ({r.get('filasPendientes')} filas pendientes).")
        fila['confirmSegundos'] = round(time.perf_counter() - inicio, 2)
        return {**fila, 'resultado': 'confirmado', 'importacionId': importacion,
                'transaccionesCreadas': r['transaccionesCreadas'], 'omitidos': len(r.get('omitidos', []))}

    def ventas(self) -> dict:
        antes = self.transacciones_en_core()
        for entrada in self.manifiesto['archivos']:
            fila = self.importar(entrada)
            self.registro['archivos'].append(fila)
            print(f"    {fila['archivo']}: {fila['resultado']} "
                  f"(preview {fila.get('previewSegundos')} s, confirm {fila.get('confirmSegundos', '-')} s)")
        despues = self.transacciones_en_core()
        return {'transaccionesAntes': antes, 'transaccionesDespues': despues, 'nuevas': despues - antes,
                'archivos': len(self.manifiesto['archivos'])}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Carga los datos del generador del Parcial 3 por HTTP.')
    parser.add_argument('--datos', type=Path, required=True, help='Carpeta con catalogo.json, manifiesto.json y ventas-*.csv')
    parser.add_argument('--auth', default='http://localhost:3101')
    parser.add_argument('--catalog', default='http://localhost:3102')
    parser.add_argument('--core', default='http://localhost:3104')
    parser.add_argument('--segmentacion', default='http://localhost:3112')
    parser.add_argument('--admin', default='admin@retail.mx')
    parser.add_argument('--gerente', default='gercategoria@retail.mx')
    parser.add_argument('--analista', default='analista@retail.mx')
    parser.add_argument('--password', default='Passw0rd123!', help='Contraseña de los usuarios del seed (solo local)')
    parser.add_argument('--timeout', type=float, default=900, help='Segundos por petición (la confirmación es lenta)')
    parser.add_argument('--solo-catalogo', action='store_true', help='Da de alta el catálogo sin importar ventas')
    args = parser.parse_args(argv)

    cliente = Cliente({'auth': args.auth, 'catalog': args.catalog, 'core': args.core, 'segmentacion': args.segmentacion},
                      {'admin': args.admin, 'gerente': args.gerente, 'analista': args.analista},
                      args.password, args.timeout)
    cargador = Cargador(cliente, args.datos)
    inicio = time.perf_counter()
    print(f"Cargando {args.datos} ({cargador.manifiesto['totales']['transacciones']} transacciones, "
          f"{cargador.manifiesto['totales']['archivos']} archivos)")
    try:
        cargador.medir('zonas', cargador.zonas)
        cargador.medir('tiendas', cargador.tiendas)
        cargador.medir('productos', cargador.productos)
        if not args.solo_catalogo:
            cargador.medir('ventas', cargador.ventas)
    except ErrorDeCarga as e:
        print(f'ERROR: {e}', file=sys.stderr)
        return 1
    finally:
        cargador.registro.update({
            'datos': str(args.datos), 'sha256Datos': cargador.manifiesto['sha256'],
            'parametros': cargador.manifiesto['parametros'], 'correlationId': cliente.correlacion,
            'terminado': datetime.now(timezone.utc).isoformat(timespec='seconds'),
            'segundosTotales': round(time.perf_counter() - inicio, 2)})
        (args.datos / 'manifiesto-carga.json').write_text(
            json.dumps(cargador.registro, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(f"Listo en {cargador.registro['segundosTotales']} s. Detalle: {args.datos / 'manifiesto-carga.json'}")
    return 0


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.exit(main())
