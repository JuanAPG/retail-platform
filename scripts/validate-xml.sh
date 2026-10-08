#!/usr/bin/env bash
# Valida que el XML que REALMENTE emiten los servicios pase contra los XSD
# de `docs/contratos/` — SIN tocar los XSD.
#
# Es el criterio de aceptación del estándar XML: la app de escritorio es
# XML-exclusiva y valida con XSD, así que un endpoint cuyo XML no valida
# bloquea el Flujo E de la demo.
#
# Uso (con el stack arriba):
#   CORE_TOKEN=<jwt-analista> scripts/validate-xml.sh
#
# Variables:
#   CORE_TOKEN      JWT de un perfil interno (obligatorio).
#   CORE_TOKEN_ADMIN JWT de Administrador. Hace falta para la bandeja de
#                   propuestas (productos pendientes, precios) y para la
#                   bitacora de audit-service: esos endpoints no los ve
#                   un Analista. Si falta, se usa CORE_TOKEN y esas filas
#                   saldran como HTTP 403.
#   HOST            host de los servicios (default localhost).
#   SOLO            filtra por servicio: SOLO=catalog scripts/validate-xml.sh
#
# Requiere `xmllint` (Debian/Ubuntu: sudo apt-get install -y libxml2-utils).
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
XSD_DIR="$RAIZ/docs/contratos"
HOST="${HOST:-localhost}"
SOLO="${SOLO:-}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if ! command -v xmllint >/dev/null 2>&1; then
  echo "Falta xmllint. Debian/Ubuntu: sudo apt-get install -y libxml2-utils" >&2
  exit 2
fi
if [[ -z "${CORE_TOKEN:-}" ]]; then
  echo "Falta CORE_TOKEN: exporta un JWT de un perfil interno." >&2
  exit 2
fi

# Chequeo previo: un token vencido o una sesion cerrada en Redis convierten
# el reporte en 20 lineas de "HTTP 401", que no dice nada util. Mejor
# abortar con el motivo.
PREVIO="$(curl -s -o /dev/null -m 5 -w '%{http_code}' \
  -H "Authorization: Bearer $CORE_TOKEN" "http://$HOST:3102/v1/zones?limit=1")"
case "$PREVIO" in
  200) ;;
  401) echo "CORE_TOKEN rechazado (401): esta vencido o su sesion no esta en Redis." >&2
       echo "Pide uno nuevo a auth-service y reintenta." >&2; exit 2 ;;
  403) echo "CORE_TOKEN valido pero su rol no puede leer el catalogo (403)." >&2
       echo "Usa un perfil interno (Analista o Administrador)." >&2; exit 2 ;;
  000) echo "catalog-service no responde en $HOST:3102. Esta el stack arriba?" >&2; exit 2 ;;
  *)   echo "catalog-service respondio $PREVIO al chequeo previo." >&2; exit 2 ;;
esac

# Ids reales del seed, para los endpoints que exigen parametros. Se
# resuelven al vuelo: sin ellos la peticion da 400 y no se llega a validar
# el XML, que es lo que este script mide.
ZONA_IDS="$(curl -s -H "Authorization: Bearer $CORE_TOKEN" \
  "http://$HOST:3102/v1/zones?limit=3" \
  | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin); print(",".join(z["id"] for z in (d.get("data") or [])))
except Exception: print("")' 2>/dev/null)"

PRODUCTO_ID="$(curl -s -H "Authorization: Bearer $CORE_TOKEN" \
  "http://$HOST:3102/v1/products?limit=1" \
  | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin); print((d.get("data") or [{}])[0].get("id",""))
except Exception: print("")' 2>/dev/null)"

AUDITORIA_ID="$(curl -s -H "Authorization: Bearer ${CORE_TOKEN_ADMIN:-$CORE_TOKEN}" \
  "http://$HOST:3110/v1/auditoria?limit=1" \
  | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin); print((d.get("data") or [{}])[0].get("id",""))
except Exception: print("")' 2>/dev/null)"

# servicio|puerto|xsd|ruta[|admin]
# Solo endpoints de LECTURA: el script no muta nada.
# `admin` marca los que exigen un rol que el Analista no tiene.
ENDPOINTS=(
  "catalog|3102|catalog-service|/v1/zones?limit=2"
  "catalog|3102|catalog-service|/v1/municipalities"
  "catalog|3102|catalog-service|/v1/zones/compare?ids=ZONA_IDS"
  "catalog|3102|catalog-service|/v1/segments"
  "catalog|3102|catalog-service|/v1/stores?limit=2"
  "catalog|3102|catalog-service|/v1/stores/catalog/postal-codes"
  "catalog|3102|catalog-service|/v1/product-categories"
  "catalog|3102|catalog-service|/v1/units"
  "catalog|3102|catalog-service|/v1/providers"
  "catalog|3102|catalog-service|/v1/products?limit=2"
  "catalog|3102|catalog-service|/v1/products/PRODUCTO_ID"
  "catalog|3102|catalog-service|/v1/products/PRODUCTO_ID/presentations"
  "catalog|3102|catalog-service|/v1/products/pending|admin"
  "pricing|3103|pricing-service|/v1/prices/history?productId=PRODUCTO_ID&limit=2"
  "pricing|3103|pricing-service|/v1/prices/compare-zones?productId=PRODUCTO_ID"
  "pricing|3103|pricing-service|/v1/price-proposals?limit=2|admin"
  "algorithms|3105|algorithms-core|/v1/association/runs?limit=2"
  "decision|3107|decision-service|/v1/accessibility/index"
  "decision|3107|decision-service|/v1/accessibility/by-zone/ZONA_ID"
  "audit|3110|audit-service|/v1/auditoria?limit=2|admin"
  "audit|3110|audit-service|/v1/auditoria/AUDITORIA_ID|admin"
)

# Errores: el mismo cuerpo tiene que validar contra el elemento `error`.
ERRORES=(
  "catalog|3102|catalog-service|/v1/zones/00000000-0000-4000-8000-000000000000|404"
  "catalog|3102|catalog-service|/v1/zones|401"
  "pricing|3103|pricing-service|/v1/prices/history?limit=abc|400"
  "decision|3107|decision-service|/v1/accessibility/index|401"
  "algorithms|3105|algorithms-core|/v1/association/runs|401"
  "audit|3110|audit-service|/v1/auditoria|401"
)

ok=0; fallo=0
declare -a FALLOS=()

# Un id de zona real, para los endpoints que lo piden.
ZONA_ID="$(curl -s -H "Authorization: Bearer $CORE_TOKEN" \
  "http://$HOST:3102/v1/zones?limit=1" \
  | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin); print((d.get("data") or [{}])[0].get("id",""))
except Exception: print("")' 2>/dev/null)"

validar() { # $1 xml  $2 xsd  $3 etiqueta
  local salida real
  salida="$(xmllint --noout --schema "$XSD_DIR/$2.xsd" "$1" 2>&1)"
  # Los targetNamespace de los XSD son URI relativas (`catalog/v1`), asi que
  # xmllint emite un "namespace warning" en TODOS los documentos. Es solo
  # un aviso, no invalida: se descarta para quedarse con el error real.
  real="$(echo "$salida" | grep -v 'namespace warning' | grep -v 'is not absolute' \
    | grep 'Schemas validity error' | head -1)"
  if [[ -z "$real" ]] && ! echo "$salida" | grep -q 'fails to validate'; then
    printf '  \033[32mok\033[0m    %s\n' "$3"
    ok=$((ok+1))
  else
    printf '  \033[31mFALLA\033[0m %s\n' "$3"
    echo "${real:-$salida}" | head -2 | sed 's/^/          /'
    fallo=$((fallo+1))
    FALLOS+=("$3 :: $(echo "${real:-$salida}" | sed 's/.*Schemas validity error : //' | head -1)")
  fi
}

echo "== Respuestas de lectura =="
for fila in "${ENDPOINTS[@]}"; do
  IFS='|' read -r svc puerto xsd ruta rol <<< "$fila"
  [[ -n "$SOLO" && "$svc" != "$SOLO" ]] && continue
  ruta="${ruta//ZONA_IDS/$ZONA_IDS}"
  ruta="${ruta//ZONA_ID/$ZONA_ID}"
  ruta="${ruta//PRODUCTO_ID/$PRODUCTO_ID}"
  ruta="${ruta//AUDITORIA_ID/$AUDITORIA_ID}"
  token="$CORE_TOKEN"
  [[ "$rol" == "admin" ]] && token="${CORE_TOKEN_ADMIN:-$CORE_TOKEN}"
  archivo="$TMP/$svc$(echo "$ruta" | tr '/?=&' '____').xml"
  codigo="$(curl -s -o "$archivo" -w '%{http_code}' \
    -H "Authorization: Bearer $token" -H 'Accept: application/xml' \
    "http://$HOST:$puerto$ruta")"
  etiqueta="$(printf '%-11s %s' "$svc" "$ruta")"
  if [[ "$codigo" != "200" ]]; then
    printf '  \033[33mHTTP %s\033[0m %s\n' "$codigo" "$etiqueta"
    fallo=$((fallo+1)); FALLOS+=("$etiqueta :: HTTP $codigo")
    continue
  fi
  validar "$archivo" "$xsd" "$etiqueta"
done

echo
echo "== Cuerpos de error (elemento 'error') =="
for fila in "${ERRORES[@]}"; do
  IFS='|' read -r svc puerto xsd ruta esperado <<< "$fila"
  [[ -n "$SOLO" && "$svc" != "$SOLO" ]] && continue
  archivo="$TMP/err_$svc$esperado.xml"
  # El 401 se provoca sin token a propósito.
  if [[ "$esperado" == "401" ]]; then
    codigo="$(curl -s -o "$archivo" -w '%{http_code}' -H 'Accept: application/xml' \
      "http://$HOST:$puerto$ruta")"
  else
    codigo="$(curl -s -o "$archivo" -w '%{http_code}' \
      -H "Authorization: Bearer $CORE_TOKEN" -H 'Accept: application/xml' \
      "http://$HOST:$puerto$ruta")"
  fi
  etiqueta="$(printf '%-11s %s -> %s' "$svc" "$ruta" "$codigo")"
  if [[ "$codigo" != "$esperado" ]]; then
    printf '  \033[33mHTTP %s (esperaba %s)\033[0m %s\n' "$codigo" "$esperado" "$etiqueta"
    fallo=$((fallo+1)); FALLOS+=("$etiqueta :: esperaba $esperado")
    continue
  fi
  validar "$archivo" "$xsd" "$etiqueta"
done

echo
echo "-------------------------------------------------"
printf 'validan: %s    fallan: %s\n' "$ok" "$fallo"
if (( fallo > 0 )); then
  echo
  echo "Fallos (para la tabla del PR):"
  for f in "${FALLOS[@]}"; do echo "  - $f"; done
fi
exit $(( fallo > 0 ? 1 : 0 ))
