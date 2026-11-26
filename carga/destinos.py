"""A dónde apunta la carga: local (un puerto por servicio) o un ambiente detrás del proxy.

En staging Juan Ángel publica una base HTTPS y el prefijo de cada servicio por ambiente; con el
Caddyfile del repo el prefijo es `/api/<servicio>` (`infra/staging/Caddyfile`). Así la misma suite
corre contra local, la VM o staging cambiando solo `--base`.

Solo biblioteca estándar: estos scripts corren antes de Locust y en cualquier Python 3.10+.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request

#: Puertos de `infra/docker-compose.yml` (CLAUDE.md y CONTRIBUTING.md).
PUERTOS = {
    "auth-service": 3101, "catalog-service": 3102, "pricing-service": 3103, "core-process-service": 3104,
    "algorithms-core": 3105, "analytics-stats": 3106, "decision-service": 3107, "documents-service": 3108,
    "notifications-service": 3109, "audit-service": 3110, "transactions-ingestion-service": 3111,
    "income-segmentation-service": 3112, "basket-analysis-service": 3113, "availability-service": 3114,
    "promotion-service": 3115, "demand-forecast-service": 3116, "recommendations-workflow-service": 3117,
    "offline-sync-service": 3118, "data-governance-service": 3119, "monitoring-service": 3120,
}


class Destino:
    """`base=None` → local (`http://localhost:<puerto>`); si no, `<base>/api/<servicio>`."""

    def __init__(self, base: str | None = None, host_local: str = "localhost"):
        self.base = base.rstrip("/") if base else None
        self.host_local = host_local

    def raiz(self, servicio: str) -> str:
        if servicio not in PUERTOS:
            raise ValueError(f"Servicio desconocido: {servicio}.")
        if self.base is None:
            return f"http://{self.host_local}:{PUERTOS[servicio]}"
        return f"{self.base}/api/{servicio}"

    def url(self, servicio: str, ruta: str) -> str:
        return f"{self.raiz(servicio)}{ruta}"

    def __str__(self) -> str:
        return self.base or f"local ({self.host_local})"


class Http:
    """JSON por HTTP. Devuelve (status, cuerpo, cabeceras) y nunca lanza por un 4xx/5xx."""

    def __init__(self, timeout: float = 15):
        self.timeout = timeout

    def pedir(self, metodo: str, url: str, cuerpo=None, token: str | None = None,
              cabeceras: dict | None = None) -> tuple[int, object, dict]:
        encabezados = {"Accept": "application/json", **(cabeceras or {})}
        if token:
            encabezados["Authorization"] = f"Bearer {token}"
        datos = None
        if cuerpo is not None:
            datos = json.dumps(cuerpo).encode()
            encabezados["Content-Type"] = "application/json"
        peticion = urllib.request.Request(url, data=datos, method=metodo, headers=encabezados)
        try:
            with urllib.request.urlopen(peticion, timeout=self.timeout) as r:
                texto = r.read().decode("utf-8")
                return r.status, json.loads(texto) if texto else None, dict(r.headers)
        except urllib.error.HTTPError as e:
            texto = e.read().decode("utf-8", "replace")
            try:
                return e.code, json.loads(texto), dict(e.headers)
            except json.JSONDecodeError:
                return e.code, texto, dict(e.headers)
