#!/usr/bin/env bash
set -euo pipefail

: "${GCP_PROJECT:?Indica el proyecto de staging}"
: "${GCP_ZONE:?Indica la zona de la VM}"
: "${STAGING_VM:?Indica la VM de staging}"
command -v gcloud >/dev/null
command -v jq >/dev/null

instance="$(gcloud compute instances describe "$STAGING_VM" --project "$GCP_PROJECT" --zone "$GCP_ZONE" --format='value(id)')"
[[ "$instance" =~ ^[0-9]+$ ]]
resource="resource.type=\"gce_instance\" AND resource.labels.instance_id=\"$instance\" AND resource.labels.zone=\"$GCP_ZONE\""

case "${1:-}" in
  estado)
    gcloud compute instances describe "$STAGING_VM" --project "$GCP_PROJECT" --zone "$GCP_ZONE" \
      --format='table(name,status,zone.basename(),machineType.basename(),id)'
    ;;
  agente)
    gcloud compute ssh "$STAGING_VM" --project "$GCP_PROJECT" --zone "$GCP_ZONE" --tunnel-through-iap \
      --command="systemctl is-active google-cloud-ops-agent.service; systemctl list-units --all 'google-cloud-ops-agent*' --no-pager; sudo -n journalctl -u 'google-cloud-ops-agent*' --since '1 hour ago' -n 40 --no-pager"
    ;;
  logs)
    correlation="${2:?Indica el X-Correlation-Id de la operación que quieres buscar}"
    [[ "$correlation" =~ ^[A-Za-z0-9._:-]{1,100}$ ]]
    filter="$resource AND (jsonPayload.correlationId=\"$correlation\" OR jsonPayload.correlation_id=\"$correlation\" OR jsonPayload.message:\"$correlation\" OR jsonPayload.log:\"$correlation\" OR textPayload:\"$correlation\")"
    gcloud logging read "$filter" --project "$GCP_PROJECT" --freshness=2h --limit=60 \
      --format='table(timestamp,logName.basename(),severity,jsonPayload.service,jsonPayload.statusCode,jsonPayload.durationMs,jsonPayload.correlationId)'
    ;;
  metricas)
    start="$(date -u -d '45 minutes ago' +%FT%TZ)"
    end="$(date -u +%FT%TZ)"
    for metric in compute.googleapis.com/instance/cpu/utilization \
      agent.googleapis.com/agent/uptime agent.googleapis.com/memory/percent_used \
      agent.googleapis.com/disk/percent_used agent.googleapis.com/interface/traffic; do
      printf '\n%s\n' "$metric"
      gcloud auth print-access-token | sed 's/^/Authorization: Bearer /' |
        curl --fail-with-body -sS --max-time 20 --get --header @- \
          --data-urlencode "filter=metric.type=\"$metric\" AND $resource" \
          --data-urlencode "interval.startTime=$start" --data-urlencode "interval.endTime=$end" \
          --data-urlencode 'view=FULL' --data-urlencode 'pageSize=200' \
          "https://monitoring.googleapis.com/v3/projects/$GCP_PROJECT/timeSeries" |
        jq '{series:([.timeSeries[]?.points[0] | {fecha:.interval.endTime,valor:.value}]),
             masPaginas:has("nextPageToken"), error}'
    done
    ;;
  *)
    printf 'Uso: %s {estado|agente|logs ID|metricas}\n' "$0" >&2
    exit 2
    ;;
esac
