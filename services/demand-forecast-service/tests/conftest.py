"""Configuración de pytest. Corre desde `services/demand-forecast-service`:

    pip install -r requirements-dev.txt
    python -m pytest

El namespace XML y el secreto se fijan antes de importar la app, como los fija el compose.
"""
import os

os.environ.setdefault("SERVICE_NAME", "demand-forecast-service")
os.environ.setdefault("XML_NAMESPACE", "forecast/v1")
os.environ.setdefault("JWT_ACCESS_SECRET", "secreto_solo_para_pruebas")
