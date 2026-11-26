#!/usr/bin/env bash
# Aplica las migraciones al Postgres de Compose y conserva su volumen.
set -euo pipefail

infra="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
compose=(docker compose -f "$infra/docker-compose.yml")
if (( $# > 0 )); then
  compose+=("$@")
fi

"${compose[@]}" up -d --wait postgres
{
  printf '%s\n' 'SELECT pg_advisory_lock(3100, 1);'
  for migration in "$infra"/../db/migraciones/*.sql; do
    printf '\\echo Aplicando %s\n' "${migration##*/}"
    cat "$migration"
    printf '\n'
  done
  printf '%s\n' 'SELECT pg_advisory_unlock(3100, 1);'
} | "${compose[@]}" exec -T postgres sh -c 'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
