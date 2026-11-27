"""Generador de datos del Parcial 3: ventas sintéticas con semilla, para volumen, Locust y los
servicios de analítica (canasta típica, pronóstico, elasticidad, asociación, clustering).

Determinista: la misma semilla y los mismos parámetros producen los mismos archivos, byte por byte
(mismo SHA-256). No usa la hora actual: la ventana termina en `--hasta` (un domingo).

Salida (carpeta `--salida`, fuera de git):
  catalogo.json      tiendas, zonas, categorías y productos que el cargador da de alta en catalog
  ventas-0001.csv …  ventas en el formato de la importación CSV de core-process
                     (folio,fecha,tienda,sku,presentacion,cantidad,precio), partidas por folio
                     completo y con dos topes por archivo: `--max-mb` (el importador acepta 5 MB) y
                     `--max-lineas` (la vista previa de core-process guarda el staging en un solo
                     INSERT de 16 valores por línea; Postgres acepta 65,535, o sea 4,095 líneas)
  existencias.json   una captura de existencia por tienda y presentación (stock y antigüedad en
                     horas) para availability-service (D-38); el cargador fija la fecha al cargar
  manifiesto.json    parámetros, filas, tamaños y SHA-256 de cada archivo, y los casos de control
                     sembrados con su valor esperado

Uso:  python db/generar_datos_parcial3.py --transacciones 10000
Carga: python db/cargar_datos_parcial3.py --datos db/generados/10000   (ver db/README-generador.md)

Solo datos de PRUEBA para desarrollo y staging. Ninguna persona real: las ventas son de tiendas y
zonas agregadas (RN-02).
"""
from __future__ import annotations

import argparse
import calendar
import hashlib
import json
import math
import random
import sys
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

VERSION = '1.2.0'
ENCABEZADO = 'folio,fecha,tienda,sku,presentacion,cantidad,precio\n'
# Tope real de la vista previa de core-process hoy: 65,535 parámetros por consulta / 16 por línea.
# Con 0 se desactiva el tope de líneas (cuando core-process guarde el staging en bloques).
LIMITE_LINEAS_CORE = 65535 // 16
MAX_LINEAS_DEFAULT = 4000
HUSO = '-06'  # America/Monterrey, sin horario de verano desde 2022

# ----------------------------------------------------------------------------- catálogo

# Perfil de consumo por segmento de la zona agregada (RN-02): productos por canasta y nivel de precio.
PERFILES = {
    'bajo': {'productos_media': 2.6, 'ajuste_precio': -0.05},
    'medio': {'productos_media': 3.4, 'ajuste_precio': 0.00},
    'alto': {'productos_media': 4.3, 'ajuste_precio': 0.08},
}
SEGMENTO_CODIGO = {'bajo': 'ING_1', 'medio': 'ING_2', 'alto': 'ING_3'}


@dataclass
class Zona:
    nombre: str
    segmento: str            # bajo | medio | alto
    municipio: str           # municipio existente (la zona nueva se crea en él)
    existe: bool             # ya está en el seed
    peso: float              # volumen relativo de ventas
    formato: str             # formato de sus tiendas nuevas
    tiendas: list[str] = field(default_factory=list)
    chica: bool = False      # zona de prueba que NO cumple D-36


ZONAS = [
    Zona('Zona Valle', 'alto', 'San Pedro Garza García', True, 1.2, 'supermercado',
         ['Super Valle Centro', 'Super Valle Norte', 'Super Valle Sur', 'Super Valle Poniente']),
    Zona('Zona Centro', 'medio', 'Monterrey', True, 1.0, 'minimarket',
         ['Abarrotes Constitución', 'Abarrotes Juárez', 'Abarrotes Madero', 'Abarrotes Morelos']),
    Zona('Zona Oriente', 'bajo', 'Guadalupe', True, 0.9, 'tienda_conveniencia',
         ['Mercado Pablo Livas', 'Mercado Linda Vista', 'Mercado Contry', 'Mercado Tolteca']),
    # D-36: 2 tiendas y 9 transacciones en todo el periodo -> ningún agregado publicable.
    Zona('Zona Norte', 'bajo', 'Monterrey', False, 0.0, 'otro',
         ['Tiendita Norte Uno', 'Tiendita Norte Dos'], chica=True),
]
TIENDAS_SEED = {'Super Valle Centro', 'Abarrotes Constitución', 'Mercado Pablo Livas'}
TRANSACCIONES_ZONA_CHICA = 9

CATEGORIAS_SEED = ['Abarrotes', 'Lácteos', 'Bebidas']
CATEGORIAS_NUEVAS = ['Huevo', 'Tortillería', 'Limpieza']


@dataclass
class Producto:
    sku: str
    nombre: str
    categoria: str
    basico: bool
    presentaciones: list[tuple[str, float, str, float]]  # (nombre, contenido, unidad, precio base)
    afinidad: tuple[float, float, float]                  # peso de elección (bajo, medio, alto)
    elasticidad: float                                    # objetivo: cantidad ~ precio^E
    existe: bool = False
    desde_semana: int = 0                                 # primera semana con venta (lanzamiento)


PRODUCTOS = [
    # --- Abarrotes
    Producto('P-001-001', 'Frijol negro', 'Abarrotes', True,
             [('1 kg', 1, 'kg', 42.50), ('500 g', 500, 'g', 24.00)], (9, 6, 4), -0.5, existe=True),
    Producto('BIO-QUI-500', 'Quinoa orgánica', 'Abarrotes', False,
             [('500 g', 500, 'g', 92.00)], (0.3, 1.5, 4), -1.6, existe=True),
    Producto('GEN-ARR-1KG', 'Arroz blanco', 'Abarrotes', True,
             [('1 kg', 1, 'kg', 32.00), ('500 g', 500, 'g', 18.00)], (8, 6, 4), -0.6),
    Producto('GEN-AZU-1KG', 'Azúcar estándar', 'Abarrotes', True,
             [('1 kg', 1, 'kg', 34.00)], (6, 5, 3), -0.4),
    Producto('GEN-ACE-1L', 'Aceite vegetal', 'Abarrotes', True,
             [('1 l', 1, 'l', 48.00), ('500 ml', 500, 'ml', 27.00)], (6, 5, 4), -0.7),
    Producto('GEN-PAS-200', 'Pasta para sopa', 'Abarrotes', True,
             [('200 g', 200, 'g', 11.50)], (7, 5, 3), -0.9),
    Producto('GEN-ATU-140', 'Atún en agua', 'Abarrotes', False,
             [('140 g', 140, 'g', 22.00)], (4, 5, 4), -1.2),
    Producto('GEN-AVE-400', 'Avena en hojuelas', 'Abarrotes', False,
             [('400 g', 400, 'g', 29.00)], (3, 4, 4), -1.1),
    Producto('GEN-CAF-200', 'Café soluble', 'Abarrotes', False,
             [('200 g', 200, 'g', 89.00)], (2, 4, 5), -1.2),
    Producto('GEN-CER-500', 'Cereal de maíz', 'Abarrotes', False,
             [('500 g', 500, 'g', 56.00)], (2, 4, 5), -1.3),
    # --- Lácteos
    Producto('LDN-LEC', 'Leche entera', 'Lácteos', True,
             [('1 L', 1, 'l', 27.50), ('250 ml', 250, 'ml', 9.50)], (9, 8, 7), -0.8, existe=True),
    Producto('LDN-QUE-400', 'Queso panela', 'Lácteos', False,
             [('400 g', 400, 'g', 55.50)], (2, 4, 5), -1.0, existe=True),
    Producto('GEN-YOG-1L', 'Yogur bebible', 'Lácteos', False,
             [('1 l', 1, 'l', 38.00)], (2, 4, 5), -1.4),
    Producto('GEN-MAN-90', 'Mantequilla', 'Lácteos', False,
             [('90 g', 90, 'g', 24.00)], (1, 3, 4), -1.2),
    # --- Huevo: dos tipos de unidad (pieza y masa) a propósito -> DF-2 responde 422
    Producto('GEN-HUE-12', 'Huevo blanco', 'Huevo', True,
             [('12 pza', 12, 'pza', 42.00), ('1 kg', 1, 'kg', 48.00)], (8, 7, 5), -0.4),
    # --- Tortillería
    Producto('GEN-TOR-1KG', 'Tortilla de maíz', 'Tortillería', True,
             [('1 kg', 1, 'kg', 24.00)], (9, 6, 3), -0.3),
    Producto('GEN-PAN-680', 'Pan de caja', 'Tortillería', False,
             [('680 g', 680, 'g', 52.00)], (3, 5, 5), -1.1),
    # --- Bebidas
    Producto('GEN-REF-600', 'Refresco de cola', 'Bebidas', False,
             [('600 ml', 600, 'ml', 18.00), ('2 l', 2, 'l', 38.00)], (6, 5, 3), -1.8),
    Producto('GEN-AGU-1L', 'Agua purificada', 'Bebidas', False,
             [('1 l', 1, 'l', 12.00)], (4, 5, 5), -1.5),
    Producto('GEN-JUG-1L', 'Jugo de naranja', 'Bebidas', False,
             [('1 l', 1, 'l', 33.00)], (1, 3, 4), -1.5),
    Producto('GEN-ENE-473', 'Bebida energética', 'Bebidas', False,
             [('473 ml', 473, 'ml', 35.00)], (2, 3, 3), -1.2),
    Producto('GEN-COC-1L', 'Agua de coco', 'Bebidas', False,
             [('1 l', 1, 'l', 45.00)], (1, 3, 4), -1.2),
    # --- Limpieza
    Producto('GEN-DET-1KG', 'Detergente en polvo', 'Limpieza', False,
             [('1 kg', 1, 'kg', 46.00)], (4, 4, 4), -0.9),
    Producto('GEN-JAB-150', 'Jabón de tocador', 'Limpieza', False,
             [('150 g', 150, 'g', 16.00)], (4, 4, 4), -0.8),
    Producto('GEN-PAP-4', 'Papel higiénico', 'Limpieza', True,
             [('4 pza', 4, 'pza', 35.00)], (5, 5, 5), -0.6),
    Producto('GEN-CLO-1L', 'Cloro', 'Limpieza', False,
             [('1 l', 1, 'l', 19.00)], (4, 4, 3), -0.9),
]
POR_SKU = {p.sku: p for p in PRODUCTOS}

# Asociaciones sembradas (verdad conocida para Apriori y FP-Growth): si la canasta lleva el
# antecedente y no el consecuente, se agrega el consecuente con esta probabilidad.
ASOCIACIONES = [('P-001-001', 'GEN-TOR-1KG', 0.60), ('LDN-LEC', 'GEN-CER-500', 0.45)]

# Precio: ciclo de 6 niveles por semana (coprimo con el ciclo de demanda de 4 semanas, para que
# la elasticidad no se confunda con la estacionalidad). Mismo criterio que el generador de elasticidad.
NIVELES_PRECIO = [-0.14, -0.08, -0.03, 0.03, 0.09, 0.14]

# Demanda: tendencia más un ciclo de 4 semanas (inicio de mes y quincena compran más).
CICLO_SEMANAL = [1.10, 0.95, 1.05, 0.90]
TENDENCIA_SEMANAL = 0.004
DIAS_SEMANA = [0.12, 0.12, 0.13, 0.13, 0.15, 0.19, 0.16]  # lunes a domingo

# Casos de control (ver manifiesto.json -> controles).
CTRL_FRONTERA_20 = 'GEN-CAF-200'    # exactamente 20 % de las canastas del grupo y mes de control
CTRL_FRONTERA_19 = 'GEN-AVE-400'    # exactamente 19 %
CTRL_ZONA_FRONTERA = 'Zona Centro'
CTRL_POCAS_VENTAS = ('BIO-QUI-500', 'Zona Oriente', 8)   # D-36: menos de 10 transacciones
CTRL_PATRON = ('GEN-AZU-1KG', 'Zona Valle')               # serie semanal exacta, sin ruido
PATRON_BASE, PATRON_TENDENCIA, PATRON_CICLO = 40, 1, [8, 0, -5, -3]
CTRL_LANZAMIENTO = {'GEN-ENE-473': 11, 'GEN-COC-1L': 12}  # semanas de historia al cierre (D-40)
CTRL_UNIDADES_MEZCLADAS = 'GEN-HUE-12'                    # DF-2: pieza y masa -> 422

# Existencias (availability-service, D-38). Una captura por tienda y presentación, con su
# antigüedad en horas; el cargador la convierte en `capturedAt` contando desde la hora de la carga
# (un dato vale 7 días: con fechas fijas estaría vencido al día siguiente de la demo).
VIGENCIA_HORAS = 7 * 24
AGOTADO_POR_SEGMENTO = {'alto': 0.05, 'medio': 0.10, 'bajo': 0.20}   # prob. de stock 0 por presentación
HORAS_CAPTURA = (1, 60)         # antigüedad normal: vigente al menos 4.5 días después de cargar
STOCK_DISPONIBLE = (4, 48)
HORAS_VENCIDO = 8 * 24 + 1      # D-38: "dato de hace 8 días -> vencido"
# Tienda de control: la segunda de Zona Centro (existe con cualquier --tiendas-por-zona).
CTRL_TIENDA_COBERTURA = ('Zona Centro', 1)
CTRL_COB_FALTANTE = 'GEN-ARR-1KG'            # todas sus presentaciones en 0 -> faltante
CTRL_COB_PARCIAL = ('GEN-ACE-1L', '1 l')      # esta presentación en 0, la otra con stock -> cubierto
CTRL_COB_VENCIDO = 'GEN-PAS-200'             # capturado hace 8 días -> vencido
CTRL_ZONA_FALTANTE = ('Zona Oriente', 'GEN-HUE-12')   # en 0 en todas las tiendas de la zona


def total_semana_patron(t: int) -> int:
    """Kilos de azúcar vendidos en Zona Valle la semana t (control del pronóstico)."""
    return PATRON_BASE + PATRON_TENDENCIA * t + PATRON_CICLO[t % 4]


# ----------------------------------------------------------------------------- utilidades

def repartir(total: int, pesos: list[float]) -> list[int]:
    """Reparte `total` en enteros proporcionales a `pesos` (mayor residuo): suma exacta."""
    suma = sum(pesos)
    crudos = [total * p / suma for p in pesos]
    enteros = [math.floor(c) for c in crudos]
    faltan = total - sum(enteros)
    orden = sorted(range(len(pesos)), key=lambda i: (-(crudos[i] - enteros[i]), i))
    for i in orden[:faltan]:
        enteros[i] += 1
    return enteros


def ultimo_mes_completo(inicio: date, fin: date) -> tuple[date, date]:
    """El mes calendario completo más reciente dentro de [inicio, fin]."""
    anio, mes = fin.year, fin.month
    while True:
        primero = date(anio, mes, 1)
        ultimo = date(anio, mes, calendar.monthrange(anio, mes)[1])
        if primero >= inicio and ultimo <= fin:
            return primero, ultimo
        mes -= 1
        if mes == 0:
            anio, mes = anio - 1, 12
        if primero < inicio:
            raise ValueError('La ventana no contiene un mes completo: usa más semanas.')


@dataclass
class Linea:
    sku: str
    presentacion: str
    cantidad: int
    precio: float


@dataclass
class Venta:
    folio: str
    instante: str     # 'YYYY-MM-DD HH:MM:00-06'
    dia: date
    semana: int
    tienda: str
    zona: str
    lineas: list[Linea] = field(default_factory=list)

    def skus(self) -> set[str]:
        return {l.sku for l in self.lineas}


# ----------------------------------------------------------------------------- generación

class Generador:
    def __init__(self, transacciones: int, semanas: int, hasta: date, tiendas_por_zona: int, semilla: int):
        if hasta.weekday() != 6:
            raise ValueError('--hasta debe ser domingo: la ventana termina en una semana completa.')
        if semanas < 16:
            raise ValueError('--semanas debe ser al menos 16 (controles de 11 y 12 semanas y un mes completo).')
        if not 2 <= tiendas_por_zona <= 4:
            raise ValueError('--tiendas-por-zona va de 2 a 4.')
        if transacciones < 5000:
            raise ValueError('--transacciones debe ser al menos 5000: el control de D-37 necesita 100 '
                             'canastas del grupo en el mes de control.')
        self.transacciones = transacciones
        self.semanas = semanas
        self.hasta = hasta
        self.inicio = hasta - timedelta(days=7 * semanas - 1)   # lunes
        self.semilla = semilla
        self.rng = random.Random(semilla)
        self.zonas = []
        for z in ZONAS:
            tiendas = z.tiendas if z.chica else z.tiendas[:tiendas_por_zona]
            self.zonas.append(Zona(z.nombre, z.segmento, z.municipio, z.existe, z.peso, z.formato,
                                   list(tiendas), z.chica))
        self.zona_de_tienda = {t: z for z in self.zonas for t in z.tiendas}
        self.codigo_tienda = {t: f'T{i + 1:02d}' for i, t in enumerate(t for z in self.zonas for t in z.tiendas)}
        self.mes_control = ultimo_mes_completo(self.inicio, hasta)
        self.folios = {t: 0 for t in self.zona_de_tienda}

    # --- calendario

    def lunes(self, semana: int) -> date:
        return self.inicio + timedelta(weeks=semana)

    def en_mes_control(self, dia: date) -> bool:
        return self.mes_control[0] <= dia <= self.mes_control[1]

    # --- precios y cantidades

    def precio(self, producto: Producto, presentacion: int, zona: Zona, semana: int) -> float:
        base = producto.presentaciones[presentacion][3]
        if (producto.sku, zona.nombre) == CTRL_PATRON:
            nivel = 0.0  # precio fijo: la serie de control no lleva efecto de precio
        else:
            i = PRODUCTOS.index(producto)
            z = self.zonas.index(zona)
            nivel = NIVELES_PRECIO[(semana * 2 + i * 3 + z * 5) % len(NIVELES_PRECIO)]
        return round(base * (1 + PERFILES[zona.segmento]['ajuste_precio']) * (1 + nivel), 2)

    def cantidad(self, producto: Producto, precio: float, presentacion: int, zona: Zona) -> int:
        base = producto.presentaciones[presentacion][3] * (1 + PERFILES[zona.segmento]['ajuste_precio'])
        factor = (precio / base) ** producto.elasticidad
        esperada = self.rng.choice([1, 1, 1, 2, 2, 3]) * factor
        return max(1, round(esperada))

    # --- una canasta

    def disponible(self, producto: Producto, zona: Zona, dia: date, semana: int) -> bool:
        if semana < producto.desde_semana:
            return False
        if producto.sku in (CTRL_FRONTERA_20, CTRL_FRONTERA_19) and zona.nombre == CTRL_ZONA_FRONTERA \
                and self.en_mes_control(dia):
            return False
        if (producto.sku, zona.nombre) == (CTRL_POCAS_VENTAS[0], CTRL_POCAS_VENTAS[1]):
            return False
        if (producto.sku, zona.nombre) == CTRL_PATRON:
            return False
        return True

    def agregar(self, venta: Venta, producto: Producto, zona: Zona, cantidad: int | None = None) -> None:
        pres = 0 if len(producto.presentaciones) == 1 else self.rng.choices(
            range(len(producto.presentaciones)), weights=[3] + [1] * (len(producto.presentaciones) - 1))[0]
        precio = self.precio(producto, pres, zona, venta.semana)
        if cantidad is None:
            cantidad = self.cantidad(producto, precio, pres, zona)
        venta.lineas.append(Linea(producto.sku, producto.presentaciones[pres][0], cantidad, precio))

    def canasta(self, venta: Venta, zona: Zona) -> None:
        segmento = ['bajo', 'medio', 'alto'].index(zona.segmento)
        candidatos = [p for p in PRODUCTOS if self.disponible(p, zona, venta.dia, venta.semana)]
        media = PERFILES[zona.segmento]['productos_media']
        n = min(len(candidatos), max(1, round(self.rng.gauss(media, 1.2))))
        pesos = [p.afinidad[segmento] for p in candidatos]
        elegidos: list[Producto] = []
        for _ in range(n):
            i = self.rng.choices(range(len(candidatos)), weights=pesos)[0]
            elegidos.append(candidatos.pop(i))
            pesos.pop(i)
        for p in elegidos:
            self.agregar(venta, p, zona)
        for antecedente, consecuente, prob in ASOCIACIONES:
            skus = venta.skus()
            producto = POR_SKU[consecuente]
            if antecedente in skus and consecuente not in skus \
                    and self.disponible(producto, zona, venta.dia, venta.semana) and self.rng.random() < prob:
                self.agregar(venta, producto, zona)

    # --- todas las ventas

    def reparto(self) -> list[tuple[str, int, int]]:
        """(tienda, semana, transacciones) para las zonas normales; la zona chica va aparte."""
        normales = [z for z in self.zonas if not z.chica]
        celdas, pesos = [], []
        for semana in range(self.semanas):
            demanda = (1 + TENDENCIA_SEMANAL * semana) * CICLO_SEMANAL[semana % 4]
            for z in normales:
                for k, tienda in enumerate(z.tiendas):
                    factor_tienda = 1.0 if tienda in TIENDAS_SEED else (0.7, 0.85, 1.05, 0.9)[k % 4]
                    celdas.append((tienda, semana))
                    pesos.append(demanda * z.peso * factor_tienda)
        total = self.transacciones - TRANSACCIONES_ZONA_CHICA
        return [(t, s, n) for (t, s), n in zip(celdas, repartir(total, pesos))]

    def nueva_venta(self, tienda: str, semana: int) -> Venta:
        zona = self.zona_de_tienda[tienda]
        dia = self.lunes(semana) + timedelta(days=self.rng.choices(range(7), weights=DIAS_SEMANA)[0])
        hora, minuto = self.rng.randint(8, 21), self.rng.randint(0, 59)
        self.folios[tienda] += 1
        folio = f'G{self.semilla}-{self.codigo_tienda[tienda]}-{self.folios[tienda]:06d}'
        return Venta(folio, f'{dia.isoformat()} {hora:02d}:{minuto:02d}:00{HUSO}', dia, semana, tienda, zona.nombre)

    def generar(self) -> list[Venta]:
        for p in PRODUCTOS:
            p.desde_semana = self.semanas - CTRL_LANZAMIENTO[p.sku] if p.sku in CTRL_LANZAMIENTO else 0
        ventas: list[Venta] = []
        for tienda, semana, n in self.reparto():
            zona = self.zona_de_tienda[tienda]
            for _ in range(n):
                venta = self.nueva_venta(tienda, semana)
                self.canasta(venta, zona)
                ventas.append(venta)
        chica = next(z for z in self.zonas if z.chica)
        for i in range(TRANSACCIONES_ZONA_CHICA):
            venta = self.nueva_venta(chica.tiendas[i % len(chica.tiendas)], self.rng.randrange(self.semanas))
            self.canasta(venta, chica)
            ventas.append(venta)
        self.sembrar_controles(ventas)
        ventas.sort(key=lambda v: (v.instante, v.folio))
        return ventas

    # --- casos de control

    def sembrar_controles(self, ventas: list[Venta]) -> None:
        por_zona: dict[str, list[Venta]] = {}
        for v in ventas:
            por_zona.setdefault(v.zona, []).append(v)
        zona = {z.nombre: z for z in self.zonas}

        # D-37: en el grupo y mes de control, un producto en 20 % exacto de las canastas y otro en 19 %.
        grupo = [v for v in por_zona[CTRL_ZONA_FRONTERA] if self.en_mes_control(v.dia)]
        if len(grupo) < 100:
            raise ValueError(f'El mes de control tiene {len(grupo)} canastas en {CTRL_ZONA_FRONTERA}; '
                             'hacen falta 100. Sube --transacciones.')
        # Deja un múltiplo de 100 canastas en el grupo y mes (20 % y 19 % exactos): las sobrantes
        # se mueven al día anterior al mes o, si cae fuera de la ventana, al siguiente.
        fuera = self.mes_control[0] - timedelta(days=1)
        if fuera < self.inicio:
            fuera = self.mes_control[1] + timedelta(days=1)
        # Al azar (con la semilla) y no las primeras de la lista: la lista va por semana, y tomar
        # las primeras vaciaba una semana entera de la zona y deformaba su serie semanal.
        movidas = set(id(v) for v in self.rng.sample(grupo, len(grupo) % 100))
        for v in grupo:
            if id(v) in movidas:
                v.dia = fuera
                v.semana = (v.dia - self.inicio).days // 7
                v.instante = f'{v.dia.isoformat()}{v.instante[10:]}'
        grupo = [v for v in grupo if id(v) not in movidas]
        for sku, k in ((CTRL_FRONTERA_20, len(grupo) // 5), (CTRL_FRONTERA_19, len(grupo) * 19 // 100)):
            for v in self.rng.sample(grupo, k):
                self.agregar(v, POR_SKU[sku], zona[CTRL_ZONA_FRONTERA])
        self.control_frontera = {'canastas': len(grupo), 'con_20': len(grupo) // 5,
                                 'con_19': len(grupo) * 19 // 100}

        # D-36: un producto con menos de 10 transacciones en una zona.
        sku, nombre_zona, n = CTRL_POCAS_VENTAS
        for v in self.rng.sample(por_zona[nombre_zona], n):
            self.agregar(v, POR_SKU[sku], zona[nombre_zona])

        # Pronóstico: serie semanal exacta (tendencia + ciclo de 4) en una zona, sin ruido de precio.
        sku, nombre_zona = CTRL_PATRON
        for semana in range(self.semanas):
            objetivo = total_semana_patron(semana)
            de_la_semana = [v for v in por_zona[nombre_zona] if v.semana == semana]
            elegidas = self.rng.sample(de_la_semana, min(len(de_la_semana), max(1, objetivo // 2)))
            for v, cantidad in zip(elegidas, repartir(objetivo, [1] * len(elegidas))):
                self.agregar(v, POR_SKU[sku], zona[nombre_zona], cantidad)

        # D-40: los productos de lanzamiento venden TODAS las semanas desde su lanzamiento en cada
        # zona normal, rotando la tienda. Así su historia mide exactamente 11 y 12 semanas y D-36
        # (10 transacciones, 3 tiendas) nunca tapa el caso, sea cual sea el volumen.
        for sku, semanas in CTRL_LANZAMIENTO.items():
            for z in self.zonas:
                if z.chica:
                    continue
                for semana in range(self.semanas - semanas, self.semanas):
                    de_la_semana = [v for v in por_zona[z.nombre] if v.semana == semana]
                    if any(sku in v.skus() for v in de_la_semana):
                        continue
                    tienda = z.tiendas[semana % len(z.tiendas)]
                    candidatas = [v for v in de_la_semana if v.tienda == tienda] or de_la_semana
                    self.agregar(candidatas[0], POR_SKU[sku], z)


# ----------------------------------------------------------------------------- escritura

def escribir(ventas: list[Venta], salida: Path, max_bytes: int, max_lineas: int = 0) -> list[dict]:
    """CSV partido por folio completo; ningún archivo pasa de `max_bytes` ni de `max_lineas` líneas
    de datos (sin contar el encabezado; 0 = sin tope de líneas). Se cierra al llegar al primero.

    Si una sola venta no cabe en un tope, falla antes de escribir: partirla rompería la venta en el
    importador y dejarla pasar generaría un archivo que el importador rechaza.
    """
    def renglones(v: Venta) -> list[str]:
        return [f'{v.folio},{v.instante},{v.tienda},{l.sku},{l.presentacion},{l.cantidad},{l.precio:.2f}\n'
                for l in v.lineas]

    encabezado = len(ENCABEZADO.encode())
    if max_lineas < 0:
        raise ValueError('--max-lineas no puede ser negativo (0 desactiva el tope).')
    mayor = max(ventas, key=lambda v: len(v.lineas))
    if max_lineas and len(mayor.lineas) > max_lineas:
        raise ValueError(f'--max-lineas {max_lineas} es menor que la venta más grande '
                         f'({mayor.folio}, {len(mayor.lineas)} líneas).')
    pesada = max(ventas, key=lambda v: len(''.join(renglones(v)).encode('utf-8')))
    if encabezado + len(''.join(renglones(pesada)).encode('utf-8')) > max_bytes:
        raise ValueError(f'--max-mb es menor que la venta más pesada ({pesada.folio}) con su encabezado.')
    salida.mkdir(parents=True, exist_ok=True)
    for viejo in salida.glob('ventas-*.csv'):
        viejo.unlink()
    archivos, bloque, tamano, transacciones, lineas = [], [], encabezado, 0, 0

    def cerrar():
        nombre = f'ventas-{len(archivos) + 1:04d}.csv'
        contenido = (ENCABEZADO + ''.join(bloque)).encode('utf-8')
        (salida / nombre).write_bytes(contenido)
        archivos.append({'archivo': nombre, 'transacciones': transacciones, 'lineas': lineas,
                         'bytes': len(contenido), 'sha256': hashlib.sha256(contenido).hexdigest()})

    for v in ventas:
        filas = renglones(v)
        peso = len(''.join(filas).encode('utf-8'))
        excede_lineas = max_lineas and lineas + len(filas) > max_lineas
        if bloque and (tamano + peso > max_bytes or excede_lineas):
            cerrar()
            bloque, tamano, transacciones, lineas = [], encabezado, 0, 0
        bloque.extend(filas)
        tamano += peso
        transacciones += 1
        lineas += len(filas)
    if bloque:
        cerrar()
    return archivos


def existencias(gen: Generador) -> list[dict]:
    """Una captura por tienda y presentación: `stock` y `haceHoras` (antigüedad al cargar).

    Usa su propio generador aleatorio (semilla + 'existencias'): no consume `gen.rng`, así que los
    CSV de ventas salen idénticos con o sin este archivo. Fuera de los controles, cada presentación
    se agota con la probabilidad de su segmento (más faltantes donde el ingreso es menor).
    """
    rng = random.Random(f'{gen.semilla}-existencias')
    zona_ctrl, indice_ctrl = CTRL_TIENDA_COBERTURA
    tienda_ctrl = next(z for z in gen.zonas if z.nombre == zona_ctrl).tiendas[indice_ctrl]
    filas = []
    for z in gen.zonas:
        for tienda in z.tiendas:
            for p in PRODUCTOS:
                for nombre, *_ in p.presentaciones:
                    agotado = rng.random() < AGOTADO_POR_SEGMENTO[z.segmento]
                    stock = 0 if agotado else rng.randint(*STOCK_DISPONIBLE)
                    horas = rng.randint(*HORAS_CAPTURA)
                    if (z.nombre, p.sku) == CTRL_ZONA_FALTANTE:
                        stock = 0
                    if tienda == tienda_ctrl and p.basico:
                        # Cobertura exacta: los básicos que no son de control quedan con stock.
                        stock = stock or rng.randint(*STOCK_DISPONIBLE)
                        if p.sku == CTRL_COB_FALTANTE or (p.sku, nombre) == CTRL_COB_PARCIAL:
                            stock = 0
                        if p.sku == CTRL_COB_VENCIDO:
                            horas = HORAS_VENCIDO
                    filas.append({'tienda': tienda, 'sku': p.sku, 'presentacion': nombre,
                                  'stock': stock, 'haceHoras': horas})
    return filas


def estado_basico(filas: list[dict]) -> str:
    """Estado de un básico en una tienda según el contrato de availability-service (D-38)."""
    vigentes = [f for f in filas if f['haceHoras'] <= VIGENCIA_HORAS]
    if any(f['stock'] > 0 for f in vigentes):
        return 'cubierto'
    if vigentes:
        return 'faltante'
    return 'vencido' if filas else 'sin_dato'


def cobertura_esperada(filas: list[dict], tiendas: list[str], basicos: list[str]) -> dict:
    """Cobertura de un grupo de tiendas como la calcula availability-service: un básico está
    cubierto si lo está en alguna tienda, faltante si ninguna lo cubre y alguna tiene dato vigente.
    Con una sola tienda es la cobertura de la tienda; con varias, la de la zona."""
    por_tienda = {}
    for f in filas:
        if f['tienda'] in tiendas:
            por_tienda.setdefault((f['tienda'], f['sku']), []).append(f)
    estados = {}
    for sku in basicos:
        en_tiendas = [estado_basico(por_tienda.get((t, sku), [])) for t in tiendas]
        for estado in ('cubierto', 'faltante', 'vencido', 'sin_dato'):
            if estado in en_tiendas:
                estados[sku] = estado
                break
    cubiertos = sum(1 for e in estados.values() if e == 'cubierto')
    return {'basics': len(basicos), 'covered': cubiertos,
            'missing': sum(1 for e in estados.values() if e == 'faltante'),
            'expired': sum(1 for e in estados.values() if e == 'vencido'),
            'noData': sum(1 for e in estados.values() if e == 'sin_dato'),
            'coverage': round(cubiertos / len(basicos) * 100, 2),
            'faltantes': sorted(s for s, e in estados.items() if e == 'faltante'),
            'vencidos': sorted(s for s, e in estados.items() if e == 'vencido')}


def controles_existencias(gen: Generador, filas: list[dict]) -> list[dict]:
    basicos = [p.sku for p in PRODUCTOS if p.basico]
    zona_ctrl, indice_ctrl = CTRL_TIENDA_COBERTURA
    tienda_ctrl = next(z for z in gen.zonas if z.nombre == zona_ctrl).tiendas[indice_ctrl]
    nota = ('Supone que los únicos básicos activos del catálogo son los del generador y que la consulta '
            'se hace dentro de los 4.5 días siguientes a la carga.')
    return [
        {'id': 'D-38-cobertura-tienda', 'tienda': tienda_ctrl, 'nota': nota,
         'esperado': cobertura_esperada(filas, [tienda_ctrl], basicos)},
        {'id': 'D-38-cobertura-zonas', 'nota': nota,
         'esperado': {z.nombre: cobertura_esperada(filas, z.tiendas, basicos) for z in gen.zonas}},
    ]


def catalogo(gen: Generador) -> dict:
    return {
        'zonas': [{'nombre': z.nombre, 'segmento': SEGMENTO_CODIGO[z.segmento], 'municipio': z.municipio,
                   'existe': z.existe, 'chica': z.chica} for z in gen.zonas],
        'tiendas': [{'nombre': t, 'zona': z.nombre, 'formato': z.formato, 'existe': t in TIENDAS_SEED,
                     'numeroSucursal': f'GEN-{gen.codigo_tienda[t]}'}
                    for z in gen.zonas for t in z.tiendas],
        'categorias': [{'nombre': c, 'existe': True} for c in CATEGORIAS_SEED]
                      + [{'nombre': c, 'existe': False} for c in CATEGORIAS_NUEVAS],
        'productos': [{'sku': p.sku, 'nombre': p.nombre, 'categoria': p.categoria, 'esCanastaBasica': p.basico,
                       'existe': p.existe,
                       'presentaciones': [{'nombre': n, 'contenido': c, 'unidadMedida': u, 'precioBase': pr}
                                          for n, c, u, pr in p.presentaciones]}
                      for p in PRODUCTOS],
    }


def controles(gen: Generador) -> list[dict]:
    zona_patron = CTRL_PATRON[1]
    return [
        {'id': 'D-37-frontera', 'zona': CTRL_ZONA_FRONTERA, 'segmento': 'ING_2',
         'dateFrom': gen.mes_control[0].isoformat(), 'dateTo': gen.mes_control[1].isoformat(),
         'canastas': gen.control_frontera['canastas'],
         'esperado': {CTRL_FRONTERA_20: {'canastas': gen.control_frontera['con_20'], 'frecuencia': 0.20,
                                         'tipico': True},
                      CTRL_FRONTERA_19: {'canastas': gen.control_frontera['con_19'], 'frecuencia': 0.19,
                                         'tipico': False}}},
        {'id': 'D-36-zona-chica', 'zona': 'Zona Norte', 'segmento': 'ING_1',
         'esperado': {'transacciones': TRANSACCIONES_ZONA_CHICA, 'tiendas': 2, 'disponible': False}},
        {'id': 'D-36-pocas-ventas', 'sku': CTRL_POCAS_VENTAS[0], 'zona': CTRL_POCAS_VENTAS[1],
         'esperado': {'transacciones': CTRL_POCAS_VENTAS[2], 'disponible': False}},
        {'id': 'D-40-patron', 'sku': CTRL_PATRON[0], 'zona': zona_patron, 'unidad': 'kg',
         'formula': f'{PATRON_BASE} + {PATRON_TENDENCIA}*t + {PATRON_CICLO}[t mod 4], t = semana desde '
                    f'{gen.inicio.isoformat()}',
         'esperado': {'semanas': gen.semanas,
                      'ultimas_4': [total_semana_patron(t) for t in range(gen.semanas - 4, gen.semanas)]}},
        *[{'id': f'D-40-historia-{semanas}', 'sku': sku, 'dateTo': gen.hasta.isoformat(),
           'esperado': {'semanas': semanas, 'status': 422 if semanas < 12 else 201}}
          for sku, semanas in CTRL_LANZAMIENTO.items()],
        {'id': 'DF-2-unidades-mezcladas', 'sku': CTRL_UNIDADES_MEZCLADAS, 'esperado': {'status': 422}},
        {'id': 'elasticidad', 'esperado': {p.sku: p.elasticidad for p in PRODUCTOS
                                           if p.sku in ('P-001-001', 'LDN-QUE-400', 'GEN-REF-600')},
         'nota': 'inelástica, unitaria y elástica; el precio sigue un ciclo de 6 semanas'},
        {'id': 'asociaciones', 'esperado': [{'antecedente': a, 'consecuente': c, 'probabilidad_agregada': p}
                                            for a, c, p in ASOCIACIONES]},
    ]


def main(argv: list[str] | None = None) -> dict:
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('--transacciones', type=int, default=10000)
    parser.add_argument('--semanas', type=int, default=52)
    parser.add_argument('--hasta', type=date.fromisoformat, default=date(2026, 11, 22),
                        help='Último día de la ventana; debe ser domingo.')
    parser.add_argument('--tiendas-por-zona', type=int, default=4)
    parser.add_argument('--semilla', type=int, default=42)
    parser.add_argument('--max-mb', type=float, default=4.5, help='Tope por archivo (el importador acepta 5 MB).')
    parser.add_argument('--max-lineas', type=int, default=MAX_LINEAS_DEFAULT,
                        help=f'Tope de líneas de datos por archivo; 0 lo desactiva. Default {MAX_LINEAS_DEFAULT}: '
                             f'la vista previa de core-process falla arriba de {LIMITE_LINEAS_CORE} líneas.')
    parser.add_argument('--salida', type=Path, default=None, help='Default: db/generados/<transacciones>')
    args = parser.parse_args(argv)

    gen = Generador(args.transacciones, args.semanas, args.hasta, args.tiendas_por_zona, args.semilla)
    ventas = gen.generar()
    salida = args.salida or Path(__file__).resolve().parent / 'generados' / str(args.transacciones)
    archivos = escribir(ventas, salida, int(args.max_mb * 1024 * 1024), args.max_lineas)
    (salida / 'catalogo.json').write_text(json.dumps(catalogo(gen), ensure_ascii=False, indent=2) + '\n',
                                          encoding='utf-8', newline='\n')
    filas_existencias = existencias(gen)
    contenido = (json.dumps({'vigenciaHoras': VIGENCIA_HORAS, 'filas': filas_existencias}, ensure_ascii=False,
                            indent=1) + '\n').encode('utf-8')
    (salida / 'existencias.json').write_bytes(contenido)
    manifiesto = {
        'generador': f'db/generar_datos_parcial3.py {VERSION}',
        'parametros': {'transacciones': args.transacciones, 'semanas': args.semanas,
                       'desde': gen.inicio.isoformat(), 'hasta': args.hasta.isoformat(),
                       'tiendasPorZona': args.tiendas_por_zona, 'semilla': args.semilla, 'maxMb': args.max_mb,
                       'maxLineas': args.max_lineas},
        'totales': {'transacciones': sum(a['transacciones'] for a in archivos),
                    'lineas': sum(a['lineas'] for a in archivos),
                    'bytes': sum(a['bytes'] for a in archivos), 'archivos': len(archivos),
                    'tiendas': len(gen.zona_de_tienda), 'productos': len(PRODUCTOS)},
        # Huella de las ventas: SHA-256 de los SHA-256 de los archivos, en orden. No incluye las
        # existencias, que llevan su propia huella: agregarlas no cambia la de las ventas ya cargadas.
        'sha256': hashlib.sha256(''.join(a['sha256'] for a in archivos).encode()).hexdigest(),
        'archivos': archivos,
        'existencias': {'archivo': 'existencias.json', 'filas': len(filas_existencias), 'bytes': len(contenido),
                        'sha256': hashlib.sha256(contenido).hexdigest()},
        'controles': controles(gen) + controles_existencias(gen, filas_existencias),
    }
    (salida / 'manifiesto.json').write_text(json.dumps(manifiesto, ensure_ascii=False, indent=2) + '\n',
                                            encoding='utf-8', newline='\n')
    return {'salida': str(salida), **manifiesto['totales'], 'sha256': manifiesto['sha256']}


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    import time
    inicio = time.perf_counter()
    resumen = main()
    resumen['segundos'] = round(time.perf_counter() - inicio, 2)
    print(json.dumps(resumen, ensure_ascii=False, indent=2))
