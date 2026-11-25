import json
import unittest
from pathlib import Path
from unittest.mock import patch

from app import app as default_app
from app import create_app
from extensions import db
from models import Cargo, User
from reset_admin_password import reset_admin_password
from routes.site import DEFAULT_STUDY_POINTS, SEMAPHORE_STUDY_POINTS
from seed import seed_database


class TestConfig:
    SECRET_KEY = "test-secret"
    SQLALCHEMY_DATABASE_URI = "sqlite://"
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    TESTING = True
    WTF_CSRF_ENABLED = False


class PublicSiteIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app(TestConfig)
        self.client = self.app.test_client()

    def tearDown(self):
        with self.app.app_context():
            db.session.remove()
            db.engine.dispose()

    @classmethod
    def tearDownClass(cls):
        with default_app.app_context():
            db.session.remove()
            db.engine.dispose()

    def register_user(self, email="operador@example.test"):
        return self.client.post(
            "/auth/registro?next=/",
            data={
                "nome": "Operador Teste",
                "email": email,
                "senha": "Senha-teste-123",
                "confirmar_senha": "Senha-teste-123",
            },
        )

    def test_seed_uses_admin_email_from_environment(self):
        admin_email = "central-admin@example.test"
        with patch.dict(
            "os.environ",
            {
                "SIMULATOR_ADMIN_EMAIL": admin_email,
                "SIMULATOR_ADMIN_PASSWORD": "Local-seed-test-123",
            },
        ):
            seed_database(self.app)

        with self.app.app_context():
            admin = db.session.scalar(
                db.select(User).where(User.email == admin_email)
            )
            self.assertIsNotNone(admin)
            self.assertEqual(admin.cargo, Cargo.ADMINISTRADOR)
            self.assertTrue(admin.verificar_senha("Local-seed-test-123"))

    def test_seed_rejects_an_existing_non_admin_for_configured_admin_email(self):
        admin_email = "existing-operator@example.test"
        with self.app.app_context():
            operator = User(
                nome="Operador Existente",
                email=admin_email,
                cargo=Cargo.OPERADOR,
                ativo=True,
            )
            operator.definir_senha("Operator-test-123")
            db.session.add(operator)
            db.session.commit()

        with patch.dict(
            "os.environ",
            {
                "SIMULATOR_ADMIN_EMAIL": admin_email,
                "SIMULATOR_ADMIN_PASSWORD": "Local-seed-test-123",
            },
        ):
            with self.assertRaisesRegex(RuntimeError, "sem perfil de administrador"):
                seed_database(self.app)

    def test_unregistered_visitors_are_redirected_to_registration(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers["Location"], "/auth/registro?next=/")
        self.assertEqual(self.client.get("/api/posts").status_code, 302)
        self.assertEqual(self.client.get("/assets/simulador3d.js").status_code, 302)

    def test_registration_unlocks_public_home(self):
        registration = self.register_user()
        self.assertEqual(registration.status_code, 302)
        self.assertEqual(registration.headers["Location"], "/")

        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("<h1>Fluxo <span>ST</span></h1>", response.get_data(as_text=True))
        self.assertIn('id="city-map"', response.get_data(as_text=True))
        self.assertNotIn("__STUDY_POINTS_JSON__", response.get_data(as_text=True))
        self.assertIn('<a href="/" class="site-link">Acessar conta</a>', response.get_data(as_text=True))
        self.assertIn('href="/admin"', response.get_data(as_text=True))
        self.assertIn('location.replace("/admin")', response.get_data(as_text=True))
        self.assertNotIn("startPresenceHeartbeat();", response.get_data(as_text=True))
        self.assertNotIn("expira após 5 minutos sem atividade", response.get_data(as_text=True))

    def test_new_members_are_operators_and_cannot_access_management(self):
        registration = self.register_user()
        self.assertEqual(registration.status_code, 302)
        self.assertEqual(registration.headers["Location"], "/")
        with self.app.app_context():
            usuario = db.session.scalar(
                db.select(User).where(User.email == "operador@example.test")
            )
            self.assertEqual(usuario.cargo, Cargo.OPERADOR)

        self.assertEqual(self.client.get("/painel").status_code, 403)
        management = self.client.get("/admin")
        self.assertEqual(management.status_code, 302)
        self.assertEqual(
            management.headers["Location"],
            "/auth/login?next=/painel",
        )
        registration_page = self.client.get("/auth/registro")
        self.assertEqual(registration_page.status_code, 200)
        self.client.post("/auth/logout")
        login = self.client.post(
            "/auth/login",
            data={"email": "operador@example.test", "senha": "Senha-teste-123"},
        )
        self.assertEqual(login.status_code, 302)
        self.assertEqual(login.headers["Location"], "/")

    def test_management_link_enters_flask_auth_flow(self):
        response = self.client.get("/admin")
        self.assertEqual(response.status_code, 302)
        self.assertIn("/auth/login?next=/painel", response.headers["Location"])
        self.assertEqual(self.client.get("/painel").status_code, 302)

    def test_engineers_can_access_management_dashboard_without_user_list(self):
        with self.app.app_context():
            usuario = User(
                nome="Engenheira Teste",
                email="engenheira@example.test",
                cargo=Cargo.ENGENHEIRO,
                ativo=True,
            )
            usuario.definir_senha("Senha-teste-123")
            db.session.add(usuario)
            db.session.commit()

        login = self.client.post(
            "/auth/login",
            data={"email": "engenheira@example.test", "senha": "Senha-teste-123"},
        )
        self.assertEqual(login.status_code, 302)
        self.assertEqual(login.headers["Location"], "/painel")
        dashboard = self.client.get("/painel")
        self.assertEqual(dashboard.status_code, 200)
        dashboard_html = dashboard.get_data(as_text=True)
        self.assertIn("<h1>Engenheira Teste</h1>", dashboard_html)
        self.assertNotIn('id="registered-users"', dashboard_html)

    def test_admin_can_publish_and_remove_site_updates(self):
        with self.app.app_context():
            usuario = User(
                nome="Admin Teste",
                email="admin@example.test",
                cargo=Cargo.ADMINISTRADOR,
                ativo=True,
            )
            usuario.definir_senha("Senha-teste-123")
            db.session.add(usuario)
            db.session.commit()

        login = self.client.post(
            "/auth/login",
            data={"email": "admin@example.test", "senha": "Senha-teste-123"},
        )
        self.assertEqual(login.status_code, 302)
        management_page = self.client.get("/publicacoes/")
        self.assertEqual(management_page.status_code, 200)
        self.assertIn("Compartilhe uma novidade", management_page.get_data(as_text=True))
        published = self.client.post(
            "/publicacoes/",
            data={"titulo": "Obras de mobilidade", "texto": "Acompanhe as próximas etapas."},
        )
        self.assertEqual(published.status_code, 302)
        posts = self.client.get("/api/posts").json["posts"]
        self.assertEqual(len(posts), 1)
        self.assertEqual(posts[0]["title"], "Obras de mobilidade")
        self.assertEqual(posts[0]["body"], "Acompanhe as próximas etapas.")

        removed = self.client.post(f"/publicacoes/{posts[0]['id']}/excluir")
        self.assertEqual(removed.status_code, 302)
        self.assertEqual(self.client.get("/api/posts").json, {"posts": []})

    def test_login_opens_panel_and_panel_links_back_to_public_site(self):
        with self.app.app_context():
            usuario = User(
                nome="Admin Teste",
                email="admin@example.test",
                cargo=Cargo.ADMINISTRADOR,
                ativo=True,
            )
            usuario.definir_senha("Senha-teste-123")
            db.session.add(usuario)
            pessoa = User(
                nome="Pessoa Cadastrada",
                email="pessoa@example.test",
                cargo=Cargo.OPERADOR,
                ativo=True,
            )
            pessoa.definir_senha("Senha-teste-123")
            db.session.add(pessoa)
            db.session.commit()

        login_page = self.client.get("/auth/login")
        self.assertEqual(login_page.status_code, 200)
        self.assertIn('<h1>Fluxo <span class="text-green">ST</span></h1>', login_page.get_data(as_text=True))

        login = self.client.post(
            "/auth/login",
            data={"email": "admin@example.test", "senha": "Senha-teste-123"},
        )
        self.assertEqual(login.status_code, 302)
        self.assertEqual(login.headers["Location"], "/painel")
        dashboard = self.client.get("/painel")
        self.assertEqual(dashboard.status_code, 200)
        dashboard_html = dashboard.get_data(as_text=True)
        self.assertIn("Site público", dashboard_html)
        self.assertIn("<h1>Admin Teste</h1>", dashboard_html)
        self.assertIn('id="registered-users"', dashboard_html)
        self.assertIn("Pessoa Cadastrada", dashboard_html)
        self.assertNotIn("pessoa@example.test", dashboard_html)
        self.assertIn('href="/usuarios/"', dashboard_html)
        users_page = self.client.get("/usuarios/")
        self.assertEqual(users_page.status_code, 200)
        self.assertIn("Pessoas cadastradas", users_page.get_data(as_text=True))
        self.assertIn("Admin Teste", users_page.get_data(as_text=True))

    def test_existing_account_link_sends_admin_to_public_site(self):
        with self.app.app_context():
            usuario = User(
                nome="Admin Teste",
                email="admin@example.test",
                cargo=Cargo.ADMINISTRADOR,
                ativo=True,
            )
            usuario.definir_senha("Senha-teste-123")
            db.session.add(usuario)
            db.session.commit()

        registration_page = self.client.get("/auth/registro?next=/painel")
        registration_html = registration_page.get_data(as_text=True)
        self.assertEqual(registration_html.count('href="/auth/login?next=/"'), 2)

        login = self.client.post(
            "/auth/login?next=/",
            data={"email": "admin@example.test", "senha": "Senha-teste-123"},
        )
        self.assertEqual(login.status_code, 302)
        self.assertEqual(login.headers["Location"], "/")
        self.assertEqual(self.client.get("/").status_code, 200)

    def test_registered_user_appears_in_admin_dashboard(self):
        with self.app.app_context():
            administrador = User(
                nome="Admin Teste",
                email="admin@example.test",
                cargo=Cargo.ADMINISTRADOR,
                ativo=True,
            )
            administrador.definir_senha("Senha-teste-123")
            db.session.add(administrador)
            db.session.commit()

        registration = self.register_user("novo-operador@example.test")
        self.assertEqual(registration.status_code, 302)
        self.client.post("/auth/logout")
        login = self.client.post(
            "/auth/login",
            data={"email": "admin@example.test", "senha": "Senha-teste-123"},
        )
        self.assertEqual(login.status_code, 302)

        dashboard = self.client.get("/painel")
        self.assertEqual(dashboard.status_code, 200)
        dashboard_html = dashboard.get_data(as_text=True)
        self.assertIn('id="registered-users"', dashboard_html)
        self.assertIn("Operador Teste", dashboard_html)
        self.assertNotIn("novo-operador@example.test", dashboard_html)

    def test_map_semaphore_points_match_geojson_export(self):
        project_root = Path(__file__).resolve().parents[1]
        geojson_path = project_root / "html" / "trafego2.0.py" / "data" / "export.geojson"
        features = json.loads(geojson_path.read_text(encoding="utf-8"))["features"]
        expected = {
            feature["id"]: [
                feature["geometry"]["coordinates"][1],
                feature["geometry"]["coordinates"][0],
            ]
            for feature in features
            if feature["properties"].get("highway") == "traffic_signals"
        }
        actual = {
            point["source_id"]: point["coords"]
            for point in SEMAPHORE_STUDY_POINTS
        }

        self.assertEqual(len(expected), 16)
        self.assertEqual(actual, expected)
        self.assertEqual(len(DEFAULT_STUDY_POINTS), 18)

        registration = self.register_user()
        self.assertEqual(registration.status_code, 302)
        homepage = self.client.get("/")
        homepage_html = homepage.get_data(as_text=True)
        self.assertEqual(homepage.status_code, 200)
        self.assertIn('id="hero-city-map"', homepage_html)
        self.assertIn('id="city-map"', homepage_html)
        self.assertIn('const heroMapContainer = document.querySelector("#hero-city-map")', homepage_html)
        self.assertIn('const cityMapContainer = document.querySelector("#city-map")', homepage_html)
        self.assertTrue("Os ícones de semáforo mostram os 16 registros extraídos" in homepage_html)
        self.assertTrue("Semáforo mapeado (OSM)" in homepage_html)
        self.assertTrue(
            all(f'"source_id": "{source_id}"' in homepage_html for source_id in expected),
            "A página inicial não incluiu todos os identificadores do GeoJSON.",
        )

    def test_admin_password_can_be_reset_for_existing_account(self):
        with self.app.app_context():
            admin = User(
                nome="Admin Teste",
                email="admin@example.test",
                cargo=Cargo.ADMINISTRADOR,
                ativo=True,
            )
            admin.definir_senha("Senha-antiga-123")
            db.session.add(admin)
            db.session.commit()

        reset_admin_password("Senha-nova-123", self.app)

        with self.app.app_context():
            admin = db.session.scalar(
                db.select(User).where(User.email == "admin@example.test")
            )
            self.assertTrue(admin.verificar_senha("Senha-nova-123"))
            self.assertFalse(admin.verificar_senha("Senha-antiga-123"))

    def test_public_site_dependencies_are_served(self):
        with self.app.app_context():
            administrador = User(
                nome="Nome Restrito",
                email="privado@example.test",
                cargo=Cargo.ADMINISTRADOR,
                ativo=True,
            )
            administrador.definir_senha("Senha-teste-123")
            db.session.add(administrador)
            db.session.commit()

        self.register_user()
        self.assertEqual(self.client.get("/publicacoes/").status_code, 403)
        self.assertEqual(self.client.get("/usuarios/").status_code, 403)
        self.assertEqual(self.client.get("/painel").status_code, 403)
        response = self.client.get("/assets/simulador3d.js")
        self.assertEqual(response.status_code, 200)
        response.close()
        self.assertEqual(self.client.get("/api/posts").json, {"posts": []})


if __name__ == "__main__":
    unittest.main()
