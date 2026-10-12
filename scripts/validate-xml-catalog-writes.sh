#!/usr/bin/env bash
# Valida contra catalog-service.xsd el XML de las 6 ESCRITURAS de producto (alta directa, propuesta, edición de
# producto y de propuesta, aprobar y rechazar). validate-xml.sh es de solo lectura por diseño y no las cubre: así
# pasó inadvertido el CAT-01/CAT-15 (la respuesta de las escrituras no traía categoria ni proveedor).
#
# MUTA datos: crea 3 productos con SKU aleatorio VAL-/VALP-/VALQ-. Usar solo en local.
#
# Uso (con el stack arriba):
#   GERENTE=<jwt Gerente de categoría> PROV=<jwt Proveedor con empresa vinculada> scripts/validate-xml-catalog-writes.sh
# Variables: HOST (default localhost). Requiere xmllint y curl.
set -u
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${HOST:-localhost}"
B="http://$HOST:3102/v1"
XSD="$RAIZ/docs/contratos/catalog-service.xsd"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
SUF=$RANDOM$RANDOM
ok=0; mal=0

peticion() { # $1 etiqueta $2 metodo $3 ruta $4 token $5 cuerpo
  local code
  code=$(curl -s -o "$TMP/r.xml" -w '%{http_code}' -X "$2" "$B$3" -H "Authorization: Bearer $4" -H 'Accept: application/xml' -H 'Content-Type: application/json' ${5:+-d "$5"})
  if [[ "$code" == 2* ]] && xmllint --noout --schema "$XSD" "$TMP/r.xml" 2>"$TMP/e.txt"; then ok=$((ok+1)); echo "ok    $1 (HTTP $code)"; else mal=$((mal+1)); echo "FALLA $1 (HTTP $code)"; grep -v 'namespace warning\|^$' "$TMP/e.txt" | head -3; fi
}
campo() { grep -o '<id>[^<]*' "$TMP/r.xml" | head -1 | sed 's/<id>//'; }

peticion "POST /products (alta directa)" POST /products "$GERENTE" "{\"sku\":\"VAL-$SUF\",\"nombre\":\"Validacion $SUF\",\"categoriaId\":1,\"presentacion\":\"1 kg\",\"contenido\":1,\"unidadMedida\":\"kg\"}"
ID=$(campo)
peticion "PATCH /products/:id" PATCH "/products/$ID" "$GERENTE" '{"descripcion":"editado por validacion"}'

peticion "POST /products/proposals" POST /products/proposals "$PROV" "{\"sku\":\"VALP-$SUF\",\"nombre\":\"Propuesta $SUF\",\"categoriaId\":1,\"presentacion\":\"500 g\",\"contenido\":500,\"unidadMedida\":\"g\"}"
P1=$(campo)
peticion "PATCH /products/proposals/:id" PATCH "/products/proposals/$P1" "$PROV" '{"descripcion":"solo cambia la descripcion"}'
peticion "PATCH /products/:id/approve" PATCH "/products/$P1/approve" "$GERENTE"

peticion "POST /products/proposals (2)" POST /products/proposals "$PROV" "{\"sku\":\"VALQ-$SUF\",\"nombre\":\"Propuesta B $SUF\",\"categoriaId\":1,\"presentacion\":\"250 g\",\"contenido\":250,\"unidadMedida\":\"g\"}"
P2=$(campo)
peticion "PATCH /products/:id/reject" PATCH "/products/$P2/reject" "$GERENTE" '{"motivoRechazo":"No cumple con el catalogo"}'
echo "validan: $ok  fallan: $mal"
[[ $mal -eq 0 ]]
