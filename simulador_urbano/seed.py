from getpass import getpass
import os
import sys

from app import create_app
from extensions import db
from models import Cargo, Congestionamento, Cruzamento, TipoIntersecao, User


DEFAULT_ADMIN_EMAIL = "admin@example.test"
ADMIN_EMAIL_ENV = "SIMULATOR_ADMIN_EMAIL"
ADMIN_PASSWORD_ENV = "SIMULATOR_ADMIN_PASSWORD"
LEGACY_ADMIN_EMAIL = "legacy-admin@example.test"


def seed_database(application=None):
    app = application or create_app()
    admin_email = (
        os.environ.get(ADMIN_EMAIL_ENV, DEFAULT_ADMIN_EMAIL).strip().casefold()
        or DEFAULT_ADMIN_EMAIL
    )
    with app.app_context():
        db.create_all()

        admin = db.session.scalar(db.select(User).where(User.email == admin_email))
        if admin is None:
            admin = db.session.scalar(
                db.select(User).where(User.email == LEGACY_ADMIN_EMAIL)
            )
            if admin is not None:
                admin.email = admin_email

        if admin is None:
            admin_password = os.environ.get(ADMIN_PASSWORD_ENV)
            if not admin_password and sys.stdin.isatty():
                admin_password = getpass("Senha inicial do administrador: ")
            if not admin_password:
                raise RuntimeError(
                    f"Defina a variável de ambiente {ADMIN_PASSWORD_ENV} "
                    "ou execute em um terminal interativo para definir a senha."
                )
            admin = User(
                nome="Administrador",
                email=admin_email,
                cargo=Cargo.ADMINISTRADOR,
                ativo=True,
            )
            admin.definir_senha(admin_password)
            db.session.add(admin)
            db.session.flush()
        elif admin.cargo != Cargo.ADMINISTRADOR:
            raise RuntimeError(
                f"A conta configurada {admin_email} já existe sem perfil de administrador."
            )

        exemplos = (
            {
                "nome": "Cruzamento Principal",
                "tipo_intersecao": TipoIntersecao.SEMAFORO,
                "tempo_verde": 30,
                "tempo_vermelho": 30,
                "onda_verde": False,
                "tempo_espera_medio": 45.0,
                "congestionamento": Congestionamento.MEDIO,
                "veiculos_minuto": 18,
            },
            {
                "nome": "Avenida Central",
                "tipo_intersecao": TipoIntersecao.ROTATORIA,
                "tempo_verde": 25,
                "tempo_vermelho": 25,
                "onda_verde": False,
                "tempo_espera_medio": 30.0,
                "congestionamento": Congestionamento.BAIXO,
                "veiculos_minuto": 12,
            },
        )

        for dados in exemplos:
            existente = db.session.scalar(
                db.select(Cruzamento).where(Cruzamento.nome == dados["nome"])
            )
            if existente is None:
                db.session.add(Cruzamento(**dados, usuario_id=admin.id))

        db.session.commit()
        print(f"Banco inicializado: {app.config['SQLALCHEMY_DATABASE_URI']}")
        print(f"Usuário administrador: {admin_email}")
        print("Os valores dos cruzamentos são exemplos para simulação, não medições de tráfego.")


if __name__ == "__main__":
    seed_database()
