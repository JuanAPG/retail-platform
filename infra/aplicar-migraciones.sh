#!/bin/sh
# Ejecutar en el contenedor de migraciones con las variables PG* de Compose.
set -eu
{
  printf '%s\n' 'SELECT pg_advisory_lock(3100, 1);'
  for migration in /migrations/*.sql; do
    printf '\\echo Aplicando %s\n' "${migration##*/}"
    printf '\\i %s\n' "$migration"
  done
  printf '%s\n' 'SELECT pg_advisory_unlock(3100, 1);'
} | psql -X -v ON_ERROR_STOP=1
