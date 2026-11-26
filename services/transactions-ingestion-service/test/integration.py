"""Run against an isolated stack with the repository's synthetic seed."""
import csv
import json
import os
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4

AUTH = os.getenv("AUTH_URL", "http://127.0.0.1:3101")
CORE = os.getenv("CORE_URL", "http://127.0.0.1:3104")
BASE = os.getenv("INGESTION_URL", "http://127.0.0.1:3111")
ROOT = Path(__file__).resolve().parents[3]


def request(base, path, method="GET", data=None, headers=None):
    req = Request(base + path, data=data, headers=headers or {}, method=method)
    try:
        result = urlopen(req, timeout=120)
    except HTTPError as error:
        result = error
    with result:
        return result.status, json.load(result)


def login(email):
    status, body = request(AUTH, "/v1/auth/login", "POST",
                           json.dumps({"email": email, "password": "Passw0rd123!"}).encode(),
                           {"Content-Type": "application/json"})
    assert status == 200, (status, body)
    return {"Authorization": "Bearer " + body["accessToken"]}


def upload(base, path, content, headers, format="csv"):
    boundary = uuid4().hex
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"ventas.{format}\"\r\n"
            "Content-Type: application/octet-stream\r\n\r\n").encode() + content + f"\r\n--{boundary}--\r\n".encode()
    status, result = request(base, path, "POST", body, {**headers, "Content-Type": f"multipart/form-data; boundary={boundary}"})
    assert status == 201, (status, result)
    return result


headers = login("analista@retail.mx")
admin = login("admin@retail.mx")
with (ROOT / "db" / "datos_prueba_100_canastas.csv").open(newline="") as handle:
    sample = next(csv.DictReader(handle))
prefix = uuid4().hex[:16]
column_names = ",".join(sample.keys()) + "\n"
suffix = ",".join(list(sample.values())[1:])

large = (column_names + "".join(f"{prefix}-{i},{suffix}\n" for i in range(5001))).encode()
legacy = upload(CORE, "/v1/transactions/import/preview", large, headers)
assert legacy["filasValidas"] == 5001, legacy["filasValidas"]
batch = upload(BASE, "/v1/transaction-imports", large, headers)
assert batch["counts"]["valid"] == 5001, batch
print("5.001 filas válidas en Core legado y 3111.")

sample["folio"] = prefix + "-confirm"
sample["cantidad"] = int(sample["cantidad"])
sample["precio"] = float(sample["precio"])
invalid = {**sample, "folio": prefix + "-error", "precio": -2}
data = json.dumps({"rows": [sample, invalid]}).encode()
path = "/v1/transaction-imports"
first = upload(BASE, path, data, headers, "json")
assert first["counts"]["valid"] == 1 and first["counts"]["rejected"] == 1
status, rows = request(BASE, f"{path}/{first['id']}/rows", headers=admin)
assert status == 200 and rows["data"][1]["code"] == "PRECIO_INVALIDO", rows
status, result = request(BASE, f"{path}/{first['id']}/confirm", "POST", headers=headers)
assert status == 200 and result["counts"]["inserted"] == 1, (status, result)
status, same = request(BASE, f"{path}/{first['id']}/confirm", "POST", headers=headers)
assert status == 200 and same == result
second = upload(BASE, path, data, headers, "json")
status, result = request(BASE, f"{path}/{second['id']}/confirm", "POST", headers=headers)
assert status == 200 and result["counts"]["inserted"] == 0 and result["counts"]["repeated"] == 1, (status, result)
print("Vista previa con error por fila, confirmación, reintento y reenvío sin duplicados.")
