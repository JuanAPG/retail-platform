#!/usr/bin/env bash
# Aplica las migraciones al Postgres de Compose y conserva su volumen.
set -euo pipefail

infra="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
compose=(docker compose -f "$infra/docker-compose.yml" "$@")

"${compose[@]}" up -d --wait postgres
"${compose[@]}" run --rm --no-deps postgres-migrations
