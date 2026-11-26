"""Ejecuta contra instancias aisladas de monitor, MongoDB y Redis."""
import json
import os
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from lxml import etree

base_url = os.environ.get("MONITOR_BASE_URL", "http://127.0.0.1:3120")
admin = os.environ["MONITOR_ADMIN_TOKEN"]
analyst = os.environ["MONITOR_ANALYST_TOKEN"]
contracts = Path(__file__).resolve().parents[3] / "docs" / "contratos"
xsds = {
    name: etree.XMLSchema(etree.parse(str(contracts / name)))
    for name in ("monitoring-service.xsd", "health.xsd")
}


def get(path, token=None, xsd=None):
    headers = {"X-Correlation-Id": "qa-monitor"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if xsd:
        headers["Accept"] = "application/xml"
    request = Request(base_url + "/v1/" + path, headers=headers)
    try:
        result = urlopen(request, timeout=5)
    except HTTPError as error:
        result = error
    with result:
        assert result.headers["X-Correlation-Id"] == "qa-monitor"
        body = result.read()
        if xsd:
            xsds[xsd].assertValid(etree.fromstring(body))
            return result.status, None
        return result.status, json.loads(body)


path = "monitoring/services"
assert get(path)[0] == 401
assert get(path, analyst, "monitoring-service.xsd")[0] == 403
assert get(path + "/no-existe/history", admin)[0] == 404
assert get("health", xsd="health.xsd")[0] == 200

history = path + "/monitoring-service/history"
for _ in range(20):
    response, page = get(history, admin)
    if response == 200 and page["total"] > 0:
        break
    time.sleep(0.5)
else:
    raise AssertionError("No apareció el sondeo del proceso propio en MongoDB.")

status, latest = get(path, admin)
assert status == 200
assert [row["port"] for row in latest["data"]] == list(range(3101, 3121))
assert latest["data"][-1]["status"] == "operativo"
assert page["data"][0]["status"] == "operativo"
assert get(path, admin, "monitoring-service.xsd")[0] == 200
assert get(history, admin, "monitoring-service.xsd")[0] == 200
print("20 servicios, sondeo propio, historial, permisos, correlación y XML verificados.")
