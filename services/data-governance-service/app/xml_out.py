"""Serialización XML de la plantilla FastAPI — espejo de `xml.interceptor.ts`.

El XML tiene que validar contra el XSD del endpoint (`docs/contratos/*.xsd`),
porque la app de escritorio es XML-exclusiva y valida con XSD. Eso impone
las mismas cuatro reglas que en la plantilla Nest:

1. **Raíz con nombre.** Los XSD declaran raíces como `zoneListResponse`, no
   `response`. Se declara por endpoint con `xml_root(...)`; sin declararla
   se conserva `<response>`, para no romper lo que todavía no la tiene.
2. **Namespace.** Los XSD usan `targetNamespace` con
   `elementFormDefault="qualified"`, así que la raíz lleva el `xmlns` por
   defecto del servicio (`XML_NAMESPACE`) y con eso los hijos quedan
   calificados sin prefijo.
3. **Declaración XML** al inicio del documento.
4. **Fechas y nulos.** `datetime`/`date` → ISO 8601. Los nulos se OMITEN,
   porque los XSD declaran los campos opcionales con `minOccurs="0"` y un
   elemento vacío no es un `xs:decimal` ni un `xs:dateTime` válido; los
   campos que su XSD exige presentes aunque sean nulos se declaran en
   `siempre_presentes`.
"""
from __future__ import annotations

import datetime as _dt
import os
import xml.etree.ElementTree as ET
from typing import Any, Iterable

PROLOGO = '<?xml version="1.0" encoding="UTF-8"?>'

#: Raíz por defecto: la conservan los endpoints que no declaran la suya.
RAIZ_POR_DEFECTO = "response"

CONTENT_TYPE_XML = "application/xml; charset=utf-8"


def namespace_xml() -> str:
    """`targetNamespace` del XSD del servicio. Vacío = sin `xmlns`."""
    return os.getenv("XML_NAMESPACE", "")


def quiere_xml(accept: str | None) -> bool:
    """Negociación de `Accept` con q-values, igual que la plantilla Nest.

    Acepta `application/xml`, `text/xml` y cualquier `*+xml`. Si el cliente
    prefiere JSON, se le da JSON; `*/*` y la ausencia del header también
    resuelven JSON, que es el default del estándar.
    """
    q_xml = 0.0
    q_json = 0.0
    for parte in (accept or "").split(","):
        trozos = [p.strip() for p in parte.split(";") if p.strip()]
        if not trozos:
            continue
        tipo = trozos[0].lower()
        q = 1.0
        for parametro in trozos[1:]:
            if parametro.startswith("q="):
                try:
                    q = float(parametro[2:])
                except ValueError:
                    q = 1.0
        if tipo in ("application/xml", "text/xml") or tipo.endswith("+xml"):
            q_xml = max(q_xml, q)
        elif tipo == "application/json":
            q_json = max(q_json, q)
    return q_xml > 0 and q_xml >= q_json


def _texto(valor: Any) -> str:
    if isinstance(valor, bool):
        # En XML Schema un booleano es "true"/"false", no "True"/"False".
        return "true" if valor else "false"
    if isinstance(valor, (_dt.datetime, _dt.date)):
        return valor.isoformat()
    return str(valor)


def _llenar(nodo: ET.Element, datos: Any, siempre: Iterable[str]) -> None:
    siempre = set(siempre)
    if isinstance(datos, dict):
        for clave, valor in datos.items():
            if valor is None:
                # Omitir: un elemento vacío no es un xs:decimal válido. Si
                # el XSD lo exige presente (uniones `*OrEmpty`), va vacío.
                if clave in siempre:
                    ET.SubElement(nodo, str(clave))
                continue
            hijo = ET.SubElement(nodo, str(clave))
            _llenar(hijo, valor, siempre)
    elif isinstance(datos, (list, tuple)):
        for valor in datos:
            hijo = ET.SubElement(nodo, "item")
            _llenar(hijo, valor, siempre)
    elif datos is not None:
        nodo.text = _texto(datos)


def serializar_xml(
    datos: Any,
    raiz: str | None = None,
    siempre_presentes: Iterable[str] = (),
    namespace: str | None = None,
) -> str:
    """Documento XML con prólogo, raíz y namespace del contrato."""
    elemento = ET.Element(raiz or RAIZ_POR_DEFECTO)
    ns = namespace_xml() if namespace is None else namespace
    if ns:
        # Atributo xmlns por defecto: con elementFormDefault="qualified"
        # eso califica a todos los hijos sin necesidad de prefijo.
        elemento.set("xmlns", ns)
    _llenar(elemento, datos, siempre_presentes)
    cuerpo = ET.tostring(elemento, encoding="unicode")
    return f"{PROLOGO}\n{cuerpo}"
