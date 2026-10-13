"""Genera db/datos_prueba_elasticidad.csv: ventas con precios que cambian día a día para probar
elasticidad (RF-18/19) y las gráficas, en las 3 zonas con tienda (Centro, Oriente, Valle).

Cada producto tiene una elasticidad objetivo por zona (cantidad ~ k * precio^E, con ruido), así que el
cálculo debe recuperar valores cercanos y cubrir las tres clasificaciones: inelástica (|E| < 1),
unitaria (≈ 1) y elástica (> 1). Determinista (semilla fija): mismo CSV cada vez.

Uso:  python db/generar_datos_elasticidad.py  >  db/datos_prueba_elasticidad.csv
Importar: pantalla «Importar CSV» del Analista (o POST /v1/transactions/import/preview + confirm).
Solo datos de PRUEBA para desarrollo local.
"""
import random
import sys
from datetime import date, timedelta

random.seed(2026)
sys.stdout.reconfigure(encoding='utf-8', newline='\n')  # el CSV va en UTF-8 aunque la consola de Windows use otra codificación

TIENDAS = {  # tienda -> factor de volumen
    'Abarrotes Constitución': 0.8,   # Zona Centro
    'Mercado Pablo Livas': 1.0,      # Zona Oriente
    'Super Valle Centro': 1.3,       # Zona Valle
}

# sku, presentación, precio base, cantidad base, elasticidad objetivo por tienda (Centro, Oriente, Valle)
PRODUCTOS = [
    ('P-001-001', '1 kg', 42.50, 6, {'Abarrotes Constitución': -0.45, 'Mercado Pablo Livas': -0.60, 'Super Valle Centro': -0.35}),    # inelástica
    ('LDN-LEC', '1 L', 27.50, 8, {'Abarrotes Constitución': -1.80, 'Mercado Pablo Livas': -1.40, 'Super Valle Centro': -0.70}),       # elástica -> inelástica
    ('LDN-QUE-400', '400 g', 55.50, 4, {'Abarrotes Constitución': -1.00, 'Mercado Pablo Livas': -0.95, 'Super Valle Centro': -1.05}),  # unitaria
    ('BIO-QUI-500', '500 g', 92.00, 3, {'Abarrotes Constitución': -2.30, 'Mercado Pablo Livas': -1.90, 'Super Valle Centro': -1.50}),  # elástica
    ('BIO-AMA-300', '300 g', 38.00, 5, {'Abarrotes Constitución': -0.75, 'Mercado Pablo Livas': -1.30, 'Super Valle Centro': -0.55}),
    ('LDN-YOG-900', '900 g', 46.00, 5, {'Abarrotes Constitución': -1.35, 'Mercado Pablo Livas': -2.10, 'Super Valle Centro': -1.10}),
]

# El precio de cada producto en cada tienda sube y baja en un ciclo de 6 niveles (-14 % … +14 %).
NIVELES = [-0.14, -0.08, -0.03, 0.03, 0.09, 0.14]
DIAS = 24
INICIO = date(2026, 9, 1)

print('folio,fecha,tienda,sku,presentacion,cantidad,precio')
folio = 0
for d in range(DIAS):
    dia = INICIO + timedelta(days=d)
    for ti, (tienda, vol) in enumerate(TIENDAS.items()):
        folio += 1
        for pi, (sku, pres, p0, q0, elas) in enumerate(PRODUCTOS):
            nivel = NIVELES[(d * 2 + pi * 3 + ti * 5) % len(NIVELES)]
            precio = round(p0 * (1 + nivel), 2)
            esperada = q0 * vol * (precio / p0) ** elas[tienda]
            cantidad = max(1, round(esperada * random.uniform(0.93, 1.07)))
            print(f'T-E-{ti + 1}-{d + 1:02d},{dia.isoformat()} 1{ti}:00:00-06,{tienda},{sku},{pres},{cantidad},{precio:.2f}')
