"""Configuración de pytest. Corre desde `services/analytics-stats`:

    pip install -r requirements-dev.txt
    python -m pytest

El namespace XML se fija antes de importar la app, como lo fija el compose.
"""
import os

os.environ.setdefault("XML_NAMESPACE", "stats/v1")
os.environ.setdefault("JWT_ACCESS_SECRET", "secreto_solo_para_pruebas")
