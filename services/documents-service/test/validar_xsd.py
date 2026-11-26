"""Valida contra un XSD el XML que llega por la entrada estándar.

Uso: python validar_xsd.py <ruta-al-xsd>   (el XML se manda por stdin)
Sale con 0 si valida, 1 si no (y dice por qué), 3 si falta lxml.
"""
import sys

try:
    from lxml import etree
except ImportError:
    sys.exit(3)

esquema = etree.XMLSchema(etree.parse(sys.argv[1]))
documento = etree.fromstring(sys.stdin.buffer.read())
if esquema.validate(documento):
    sys.exit(0)
print("; ".join(str(error) for error in esquema.error_log))
sys.exit(1)
