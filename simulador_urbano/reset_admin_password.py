from getpass import getpass
import os
from pathlib import Path

from app import app
from extensions import db
from models import Cargo, User


ADMIN_EMAIL = (
    os.environ.get("SIMULATOR_ADMIN_EMAIL", "admin@example.test").strip().casefold()
)


def _require_existing_local_database(application):
    with application.app_context():
        database_url = db.engine.url
        if database_url.get_backend_name() != "sqlite" or not database_url.database:
            raise RuntimeError("A redefinição só é permitida no banco SQLite local.")
        if database_url.database == ":memory:" or not Path(database_url.database).is_file():
            raise RuntimeError("O banco SQLite local não existe.")


def reset_admin_password(password, application=app):
    if not isinstance(password, str) or len(password) < 8:
        raise ValueError("A senha deve ter pelo menos 8 caracteres.")

    with application.app_context():
        admin = db.session.scalar(
            db.select(User).where(
                User.email == ADMIN_EMAIL,
                User.cargo == Cargo.ADMINISTRADOR,
            )
        )
        if admin is None:
            raise RuntimeError(f"A conta de administrador {ADMIN_EMAIL} não foi encontrada.")

        admin.definir_senha(password)
        db.session.commit()


def main():
    _require_existing_local_database(app)
    password = getpass("Nova senha do administrador (mínimo 8 caracteres): ")
    confirmation = getpass("Confirme a nova senha: ")
    if password != confirmation:
        raise ValueError("As senhas não conferem.")

    reset_admin_password(password, app)
    print(f"Senha redefinida para a conta {ADMIN_EMAIL}.")


if __name__ == "__main__":
    main()
