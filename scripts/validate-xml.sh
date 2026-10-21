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
# Para validar hace falta `xmllint` (Debian/Ubuntu: sudo apt-get install -y
# libxml2-utils) O Python 3 con `lxml` (pip install lxml). Antes solo servia
# xmllint y en Windows el script moria de entrada; es el mismo motivo por el
# que los fallos 8 y 9 de la corrida del 13-oct dejaron sin verificar el XML
# de audit-service.
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
XSD_DIR="$RAIZ/docs/contratos"
HOST="${HOST:-localhost}"
SOLO="${SOLO:-}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Validador: xmllint si esta en el PATH; si no, Python 3 con lxml. En Windows
# `python3` puede ser otro interprete sin lxml (MSYS), asi que se prueban los
# tres nombres. Mismo mecanismo que services/*/test/apoyo.ts.
VALIDA_CON_LXML='
import sys
from lxml import etree
esquema = etree.XMLSchema(etree.parse(sys.argv[1]))
documento = etree.parse(sys.argv[2])
if not esquema.validate(documento):
    print("\n".join(str(e) for e in esquema.error_log))
    sys.exit(1)
'
VALIDADOR=""
PYBIN=""
if command -v xmllint >/dev/null 2>&1; then
  VALIDADOR="xmllint"
else
  for p in python3 python py; do
    if command -v "$p" >/dev/null 2>&1 && "$p" -c 'import lxml' >/dev/null 2>&1; then
      VALIDADOR="lxml"; PYBIN="$p"; break
    fi
  done
fi
if [[ -z "$VALIDADOR" ]]; then
  echo "No hay con que validar el XML contra el XSD." >&2
  echo "Instala xmllint (Debian/Ubuntu: sudo apt-get install -y libxml2-utils;" >&2
  echo "macOS: brew install libxml2) o Python 3 con lxml (pip install lxml)." >&2
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

PRESENTACION_ID="$(curl -s -H "Authorization: Bearer $CORE_TOKEN" \
  "http://$HOST:3102/v1/products/$PRODUCTO_ID/presentations" \
  | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin); print((d or [{}])[0].get("id",""))
except Exception: print("")' 2>/dev/null)"

AUDITORIA_ID="$(curl -s -H "Authorization: Bearer ${CORE_TOKEN_ADMIN:-$CORE_TOKEN}" \
  "http://$HOST:3110/v1/auditoria?limit=1" \
  | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin); print((d.get("data") or [{}])[0].get("id",""))
except Exception: print("")' 2>/dev/null)"

# algorithms-core: una presentacion CON elasticidad calculada (sin ella el
# grafico es 404 y no hay XML de exito que validar) y una corrida de Apriori.
# Hace falta haber calculado elasticidad y corrido Apriori al menos una vez.
PRES_ELASTICIDAD_ID="$(curl -s -H "Authorization: Bearer $CORE_TOKEN" \
  "http://$HOST:3105/v1/elasticity/current?limit=1" \
  | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin); print((d.get("data") or [{}])[0].get("presentationId",""))
except Exception: print("")' 2>/dev/null)"

CORRIDA_ID="$(curl -s -H "Authorization: Bearer $CORE_TOKEN" \
  "http://$HOST:3105/v1/association/runs?limit=1" \
  | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin); print((d.get("data") or [{}])[0].get("id",""))
except Exception: print("")' 2>/dev/null)"

# Una categoria real del catalogo, para los patrones de sustitucion.
CATEGORIA_ID="$(curl -s -H "Authorization: Bearer $CORE_TOKEN" \
  "http://$HOST:3102/v1/product-categories" \
  | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin); print((d or [{}])[0].get("id",""))
except Exception: print("")' 2>/dev/null)"

# analytics-stats: una corrida de clustering guardada (la crea un Analista con
# POST /v1/clustering/run; el script solo lee).
CLUSTERING_ID="$(curl -s -H "Authorization: Bearer $CORE_TOKEN"   "http://$HOST:3106/v1/clustering/runs?limit=1"   | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin); print((d.get("data") or [{}])[0].get("id",""))
except Exception: print("")' 2>/dev/null)"

# documents-service: un reporte ya generado (lo crea un Gerente con
# POST /v1/reports/executive; el script solo lee). Sin el, la fila del detalle
# sale como HTTP 400/404 y se reporta como tal.
REPORTE_ID="$(curl -s -H "Authorization: Bearer $CORE_TOKEN" \
  "http://$HOST:3108/v1/reports?limit=1" \
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
  "pricing|3103|pricing-service|/v1/prices/current?presentationId=PRESENTACION_ID"
  "pricing|3103|pricing-service|/v1/prices/series?presentationId=PRESENTACION_ID"
  "pricing|3103|pricing-service|/v1/prices/alert-settings|admin"
  "pricing|3103|pricing-service|/v1/price-observations?limit=2|admin"
  "algorithms|3105|algorithms-core|/v1/association/runs?limit=2"
  "algorithms|3105|algorithms-core|/v1/association/runs/CORRIDA_ID"
  "algorithms|3105|algorithms-core|/v1/elasticity/current?limit=2"
  "algorithms|3105|algorithms-core|/v1/elasticity/chart?presentationId=PRES_ELASTICIDAD_ID"
  "algorithms|3105|algorithms-core|/v1/elasticity/chart?presentationId=PRES_ELASTICIDAD_ID&groupBy=segment"
  "algorithms|3105|algorithms-core|/v1/substitution/patterns?categoryId=CATEGORIA_ID"
  "analytics|3106|analytics-stats|/v1/clustering/runs?limit=2"
  "analytics|3106|analytics-stats|/v1/clustering/runs/CLUSTERING_ID"
  # /v1/accessibility/index NO va aqui: el contrato lo marca como una
  # ESCRITURA disfrazada de GET (QA-DEC51-08) — cada llamada calcula y
  # PERSISTE una corrida nueva en `analisis_corridas` y deja un evento en la
  # bitacora. Este script declara no mutar nada, asi que no puede pedirla.
  # Ademas exige `?zoneId&segmentId`, y la fila los omitia: salia HTTP 400 en
  # cada corrida y se contaba como fallo de XML sin serlo. Su cuerpo de error
  # (401) si se valida abajo.
  "decision|3107|decision-service|/v1/accessibility/by-zone/ZONA_ID"
  "documents|3108|documents-service|/v1/reports?limit=2"
  "documents|3108|documents-service|/v1/reports/stats/by-user-month"
  "documents|3108|documents-service|/v1/reports/REPORTE_ID"
  "notifications|3109|notifications-service|/v1/notifications?limit=2"
  "notifications|3109|notifications-service|/v1/notifications/unread-count"
  "audit|3110|audit-service|/v1/auditoria?limit=2|admin"
  "audit|3110|audit-service|/v1/auditoria/AUDITORIA_ID|admin"
)

# Errores: el mismo cuerpo tiene que validar contra el elemento `error`.
#
# auth-service (3101) aparece SOLO aqui, en los cuerpos de error, y no arriba
# con una fila de exito. Dos motivos:
#   - Los unicos exitos que su XSD declara (loginResponse, refreshResponse,
#     validateResponse) son POST, y este script es de solo lectura por diseno
#     (un login ademas crea sesion en Redis).
#   - Sus rutas de LECTURA (GET /v1/usuarios, /v1/usuarios/:id, /v1/roles,
#     /v1/roles/:id/permisos) no tienen elemento en auth-service.xsd, asi que
#     hoy no hay con que validarlas. Ver el hallazgo del PR: auth-service
#     tampoco declara @XmlRoot en ningun handler, de modo que su XML de exito
#     sale como <response> y no valida contra su propio XSD.
ERRORES=(
  "auth|3101|auth-service|/v1/usuarios|401"
  "auth|3101|auth-service|/v1/roles|401"
  "documents|3108|documents-service|/v1/reports|401"
  "documents|3108|documents-service|/v1/reports/stats/by-user-month|401"
  "catalog|3102|catalog-service|/v1/zones/00000000-0000-4000-8000-000000000000|404"
  "catalog|3102|catalog-service|/v1/zones|401"
  "pricing|3103|pricing-service|/v1/prices/history?limit=abc|400"
  "pricing|3103|pricing-service|/v1/prices/series?presentationId=00000000-0000-4000-8000-000000000000&dateFrom=2026-13-45|400"
  "decision|3107|decision-service|/v1/accessibility/index|401"
  "algorithms|3105|algorithms-core|/v1/association/runs|401"
  "algorithms|3105|algorithms-core|/v1/elasticity/current|401"
  "algorithms|3105|algorithms-core|/v1/elasticity/current?page=1000001|400"
  "algorithms|3105|algorithms-core|/v1/elasticity/chart?presentationId=00000000-0000-4000-8000-000000000000|404"
  "algorithms|3105|algorithms-core|/v1/substitution/patterns?categoryId=999999|404"
  "analytics|3106|analytics-stats|/v1/clustering/runs|401"
  "analytics|3106|analytics-stats|/v1/clustering/runs/abc|400"
  "analytics|3106|analytics-stats|/v1/clustering/runs/000000000000000000000000|404"
  "notifications|3109|notifications-service|/v1/notifications|401"
  "audit|3110|audit-service|/v1/auditoria|401"
)

ok=0; fallo=0; omitida=0
declare -a FALLOS=()
declare -a OMITIDAS=()

# Un id de zona real, para los endpoints que lo piden.
ZONA_ID="$(curl -s -H "Authorization: Bearer $CORE_TOKEN" \
  "http://$HOST:3102/v1/zones?limit=1" \
  | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin); print((d.get("data") or [{}])[0].get("id",""))
except Exception: print("")' 2>/dev/null)"

# Placeholders que se resuelven al vuelo contra la base. Si alguno sale VACIO
# (la base no tiene ese dato previo: una corrida de elasticidad, un reporte
# generado...), la fila que lo usa se OMITE diciendo cual falto, en vez de
# pedirse con el id en blanco. Antes esas filas salian como `HTTP 400` y se
# contaban como fallos de XML sin serlo: el 13-oct se reportaron asi los dos
# `elasticity/chart` de una base sin elasticidad calculada.
#
# ZONA_IDS va ANTES que ZONA_ID: el detector corta en la primera coincidencia
# y `ZONA_ID` es prefijo de `ZONA_IDS`.
IDS=(
  "ZONA_IDS=$ZONA_IDS"
  "ZONA_ID=$ZONA_ID"
  "PRODUCTO_ID=$PRODUCTO_ID"
  "PRESENTACION_ID=$PRESENTACION_ID"
  "AUDITORIA_ID=$AUDITORIA_ID"
  "PRES_ELASTICIDAD_ID=$PRES_ELASTICIDAD_ID"
  "CORRIDA_ID=$CORRIDA_ID"
  "CATEGORIA_ID=$CATEGORIA_ID"
  "CLUSTERING_ID=$CLUSTERING_ID"
  "REPORTE_ID=$REPORTE_ID"
)

# Imprime el nombre del primer placeholder que la ruta use y que este vacio.
faltante() { # $1 ruta
  local ruta="$1" par nombre valor
  for par in "${IDS[@]}"; do
    nombre="${par%%=*}"; valor="${par#*=}"
    case "$ruta" in
      *"$nombre"*) if [[ -z "$valor" ]]; then echo "$nombre"; return 0; fi; return 1 ;;
    esac
  done
  return 1
}

validar() { # $1 xml  $2 xsd  $3 etiqueta
  local salida estado real
  if [[ "$VALIDADOR" == "xmllint" ]]; then
    salida="$(xmllint --noout --schema "$XSD_DIR/$2.xsd" "$1" 2>&1)"; estado=$?
  else
    salida="$("$PYBIN" -c "$VALIDA_CON_LXML" "$XSD_DIR/$2.xsd" "$1" 2>&1)"; estado=$?
  fi
  # Los targetNamespace de los XSD son URI relativas (`catalog/v1`), asi que
  # xmllint emite un "namespace warning" en TODOS los documentos. Es solo
  # un aviso, no invalida (no cambia el codigo de salida): se descarta para
  # quedarse con el error real.
  real="$(echo "$salida" | grep -v 'namespace warning' | grep -v 'is not absolute' \
    | grep -E 'Schemas validity error|ERROR:SCHEMASV' | head -1)"
  if (( estado == 0 )); then
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
  etiqueta="$(printf '%-11s %s' "$svc" "$ruta")"
  if falta="$(faltante "$ruta")"; then
    printf '  \033[33momitida\033[0m %s\n' "$etiqueta"
    printf '          sin dato previo en esta base: %s no se pudo resolver\n' "$falta"
    omitida=$((omitida+1)); OMITIDAS+=("$etiqueta :: falta $falta")
    continue
  fi
  ruta="${ruta//ZONA_IDS/$ZONA_IDS}"
  ruta="${ruta//ZONA_ID/$ZONA_ID}"
  ruta="${ruta//PRODUCTO_ID/$PRODUCTO_ID}"
  ruta="${ruta//PRESENTACION_ID/$PRESENTACION_ID}"
  ruta="${ruta//AUDITORIA_ID/$AUDITORIA_ID}"
  ruta="${ruta//PRES_ELASTICIDAD_ID/$PRES_ELASTICIDAD_ID}"
  ruta="${ruta//CORRIDA_ID/$CORRIDA_ID}"
  ruta="${ruta//CATEGORIA_ID/$CATEGORIA_ID}"
  ruta="${ruta//CLUSTERING_ID/$CLUSTERING_ID}"
  ruta="${ruta//REPORTE_ID/$REPORTE_ID}"
  token="$CORE_TOKEN"
  [[ "$rol" == "admin" ]] && token="${CORE_TOKEN_ADMIN:-$CORE_TOKEN}"
  archivo="$TMP/$svc$(echo "$ruta" | tr '/?=&' '____').xml"
  codigo="$(curl -s -o "$archivo" -w '%{http_code}' \
    -H "Authorization: Bearer $token" -H 'Accept: application/xml' \
    "http://$HOST:$puerto$ruta")"
  # Se recalcula con la ruta ya sustituida, para que el reporte traiga el id real.
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
printf 'validan: %s    fallan: %s    omitidas: %s\n' "$ok" "$fallo" "$omitida"
if (( omitida > 0 )); then
  echo
  echo "Omitidas por falta de datos previos (NO son fallos de XML):"
  for o in "${OMITIDAS[@]}"; do echo "  - $o"; done
fi
if (( fallo > 0 )); then
  echo
  echo "Fallos (para la tabla del PR):"
  for f in "${FALLOS[@]}"; do echo "  - $f"; done
fi
exit $(( fallo > 0 ? 1 : 0 ))
