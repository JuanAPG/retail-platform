"""Cuentas sintéticas y sesiones previas, sin red (solo biblioteca estándar).

    python -m unittest discover -s carga/tests -v
"""
import base64
import json
import sys
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import sesiones  # noqa: E402
import usuarios_carga as uc  # noqa: E402
from destinos import Destino  # noqa: E402


def jwt(exp: float) -> str:
    carga = base64.urlsafe_b64encode(json.dumps({"sub": "u", "exp": exp}).encode()).decode().rstrip("=")
    return f"cabecera.{carga}.firma"


class HttpFalso:
    """Responde con una función por (método, ruta) y anota cada petición."""

    def __init__(self, responder):
        self.responder, self.pedidas = responder, []

    def pedir(self, metodo, url, cuerpo=None, token=None, cabeceras=None):
        self.pedidas.append((metodo, url, cuerpo, token))
        return self.responder(metodo, url, cuerpo)


class RelojFalso:
    def __init__(self):
        self.t, self.dormido = 0.0, []

    def ahora(self):
        return self.t

    def dormir(self, s):
        self.dormido.append(round(s, 3))
        self.t += s


class DestinosTest(unittest.TestCase):
    def test_local_por_puerto_y_staging_por_prefijo(self):
        self.assertEqual(Destino().url("auth-service", "/v1/auth/login"), "http://localhost:3101/v1/auth/login")
        self.assertEqual(Destino("https://staging.ejemplo/").url("demand-forecast-service", "/v1/forecast/runs"),
                         "https://staging.ejemplo/api/demand-forecast-service/v1/forecast/runs")
        with self.assertRaises(ValueError):
            Destino().raiz("no-existe")


class CuentasTest(unittest.TestCase):
    def test_correos_estables_y_un_rol_real_por_perfil(self):
        lista = uc.cuentas(2)
        self.assertEqual(len(lista), 10)
        self.assertEqual(lista[0], {"perfil": "catalogo", "rol": "Responsable de precios",
                                    "email": "carga.catalogo.01@retail-carga.test"})
        self.assertEqual(uc.cuentas(2), lista)  # repetible
        self.assertEqual(len({c["email"] for c in uc.cuentas(12)}), 60)

    def respuestas(self, ya_existen=(), roles=("Administrador", "Analista comercial", "Gerente de categoría",
                                                "Responsable de precios")):
        creadas = []

        def responder(metodo, url, cuerpo):
            if url.endswith("/v1/roles"):
                return 200, [{"id": i + 1, "nombre": r} for i, r in enumerate(roles)], {}
            if "/v1/usuarios?" in url:
                return 200, {"data": [{"email": e} for e in ya_existen], "total": len(ya_existen)}, {}
            creadas.append(cuerpo)
            return 201, {"id": "x", **cuerpo}, {}
        return responder, creadas

    def test_crea_las_que_faltan_y_reutiliza_las_existentes(self):
        responder, creadas = self.respuestas(ya_existen=["carga.analista.01@retail-carga.test"])
        r = uc.asegurar(HttpFalso(responder), Destino(), "tok", 2, "Carga2026x")
        self.assertEqual(r["perfiles"]["analista"], {"creadas": 1, "existentes": 1})
        self.assertEqual(r["perfiles"]["catalogo"], {"creadas": 2, "existentes": 0})
        self.assertEqual(creadas[0]["rolId"], 4)  # Responsable de precios
        self.assertTrue(all(c["activo"] for c in creadas))

    def test_rol_que_no_existe_se_reporta_y_se_salta(self):
        responder, creadas = self.respuestas()
        r = uc.asegurar(HttpFalso(responder), Destino(), "tok", 2, "Carga2026x")
        self.assertEqual(r["rolesFaltantes"], ["Investigador de mercado"])
        self.assertEqual(r["perfiles"]["investigador"], {"creadas": 0, "existentes": 0})
        self.assertNotIn("investigador", {c["email"].split(".")[1] for c in creadas})

    def test_contrasena_debil_se_rechaza_antes_de_crear(self):
        responder, creadas = self.respuestas()
        with self.assertRaises(uc.ErrorCarga):
            uc.asegurar(HttpFalso(responder), Destino(), "tok", 1, "debil")
        self.assertEqual(creadas, [])


class SesionesTest(unittest.TestCase):
    LISTA = uc.cuentas(3, {"analista": "Analista comercial"})

    def test_ritmo_de_14_logins_por_minuto(self):
        http = HttpFalso(lambda m, u, c: (200, {"accessToken": jwt(0), "refreshToken": "r"}, {}))
        reloj = RelojFalso()
        r = sesiones.iniciar(http, Destino(), self.LISTA, "x", reloj, avisar=lambda *_: None)
        self.assertEqual(len(r["sesiones"]), 3)
        self.assertEqual(reloj.dormido, [round(60 / 14, 3)] * 2)  # nada antes del primero
        self.assertLessEqual(sesiones.LOGINS_POR_MINUTO, 14)

    def test_un_429_respeta_retry_after_y_se_cuenta_aparte(self):
        respuestas = iter([(200, {"accessToken": jwt(0), "refreshToken": "r"}, {}),
                           (429, {"message": "Demasiados intentos"}, {"Retry-After": "30"}),
                           (200, {"accessToken": jwt(0), "refreshToken": "r"}, {}),
                           (200, {"accessToken": jwt(0), "refreshToken": "r"}, {})])
        reloj = RelojFalso()
        r = sesiones.iniciar(HttpFalso(lambda *a: next(respuestas)), Destino(), self.LISTA, "x", reloj,
                             avisar=lambda *_: None)
        self.assertEqual((len(r["sesiones"]), r["rechazos429"]), (3, 1))
        self.assertIn(30.0, reloj.dormido)

    def test_login_fallido_se_reporta(self):
        http = HttpFalso(lambda m, u, c: (401, {"message": "Credenciales inválidas"}, {}))
        r = sesiones.iniciar(http, Destino(), self.LISTA[:1], "x", RelojFalso(), avisar=lambda *_: None)
        self.assertEqual((r["sesiones"], r["fallidas"][0]["status"]), ([], 401))

    def test_vencimiento_y_renovacion(self):
        ahora = time.time()
        self.assertAlmostEqual(sesiones.vence_en(jwt(ahora + 900), ahora), 900)
        self.assertTrue(sesiones.necesita_renovar({"accessToken": jwt(time.time() + 60)}))
        self.assertFalse(sesiones.necesita_renovar({"accessToken": jwt(time.time() + 600)}))
        http = HttpFalso(lambda m, u, c: (200, {"accessToken": "nuevo", "refreshToken": "r2"}, {}))
        nueva = sesiones.renovar(http, Destino(), {"email": "a", "accessToken": "viejo", "refreshToken": "r1"})
        self.assertEqual((nueva["accessToken"], nueva["refreshToken"]), ("nuevo", "r2"))
        self.assertEqual(http.pedidas[0][2], {"refreshToken": "r1"})

    def test_guardar_y_cargar(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            archivo = Path(tmp) / "s.json"
            sesiones.guardar([{"email": "a"}], Destino("https://staging"), archivo)
            self.assertEqual(sesiones.cargar(archivo), {"destino": "https://staging", "base": "https://staging",
                                                        "sesiones": [{"email": "a"}]})


if __name__ == "__main__":
    unittest.main()
