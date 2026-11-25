import json
from datetime import timezone
from pathlib import Path

from flask import Blueprint, Response, flash, jsonify, redirect, request, send_from_directory, url_for
from flask_login import current_user, logout_user

from extensions import db
from models import Cargo, Publicacao


site_bp = Blueprint("site", __name__)
PROJECT_ROOT = Path(__file__).resolve().parents[1]
TRAFFIC_PAGE = PROJECT_ROOT / "html" / "trafego.html"
SIMULATOR_JS = Path(__file__).resolve().parents[1] / "static" / "js"


@site_bp.before_request
def require_registration_for_public_site():
    protected_endpoints = {
        "site.public_home",
        "site.public_posts",
        "site.simulator_script",
    }
    if request.endpoint in protected_endpoints and not current_user.is_authenticated:
        next_url = request.full_path.rstrip("?")
        return redirect(url_for("auth.registro", next=next_url))


SEMAPHORE_SOURCE_POINTS = (
    ("node/1963227166", -7.990956, -38.2991378),
    ("node/2153262040", -7.9855423, -38.2905563),
    ("node/2153262067", -7.9885802, -38.2942306),
    ("node/2153262085", -7.9901824, -38.302447),
    ("node/2324433495", -7.9868538, -38.2877627),
    ("node/2324433602", -7.9881829, -38.2984646),
    ("node/2324433625", -7.989009, -38.2915062),
    ("node/2324433652", -7.9892919, -38.2895456),
    ("node/2324433752", -7.9912383, -38.2979447),
    ("node/2324433753", -7.9913026, -38.2937613),
    ("node/2584235897", -7.9913561, -38.2937012),
    ("node/2598082743", -7.9905186, -38.3010096),
    ("node/3715410841", -7.9916148, -38.296407),
    ("node/3755409807", -7.9845006, -38.2902552),
    ("node/7691063939", -7.9915637, -38.2963994),
    ("node/7691189660", -7.9886048, -38.2942491),
)

SEMAPHORE_STUDY_POINTS = tuple(
    {
        "id": index + 2,
        "title": f"Semáforo mapeado {index + 1:02d}",
        "place": "Extração do OpenStreetMap",
        "type": "tempo",
        "coords": [latitude, longitude],
        "source_id": osm_id,
        "note": (
            f"Ponto de highway=traffic_signals do export.geojson ({osm_id}); "
            "confirme a localização e a situação atual em campo."
        ),
    }
    for index, (osm_id, latitude, longitude) in enumerate(SEMAPHORE_SOURCE_POINTS)
)

DEFAULT_STUDY_POINTS = (
    {
        "id": 1,
        "title": "Centro · fluxo na rotatória",
        "place": "Entorno da área central",
        "type": "rotatoria",
        "coords": [-7.9827, -38.2894],
        "note": "Verificar se a geometria do cruzamento comporta uma rotatória com segurança e sem prejudicar pedestres e acessos.",
    },
    *SEMAPHORE_STUDY_POINTS,
    {
        "id": 18,
        "title": "Acesso urbano · travessias e conversões",
        "place": "Conexão com vias de maior movimento",
        "type": "seguranca",
        "coords": [-7.9865, -38.2977],
        "note": "Observar conflitos entre veículos e pedestres e avaliar a segurança das travessias e conversões.",
    },
)


@site_bp.get("/")
def public_home():
    template = TRAFFIC_PAGE.read_text(encoding="utf-8")
    template = template.replace('href="#admin"', 'href="/admin"')
    template = template.replace(
        'window.addEventListener("hashchange", handleAdminRoute);\n'
        '        startPresenceHeartbeat();\n'
        '        loadPosts();\n'
        '        handleAdminRoute();',
        'window.addEventListener("hashchange", () => {\n'
        '            if (location.hash === "#admin") window.location.assign("/admin");\n'
        '        });\n'
        '        loadPosts();\n'
        '        if (location.hash === "#admin") window.location.replace("/admin");',
    )
    template = template.replace(
        "O monitoramento administrativo usa identificador temporário por aba, sem armazenar IP, "
        "e expira após 5 minutos sem atividade.",
        "A área de gestão exige autenticação; as simulações são educativas e não substituem estudos de campo.",
    )
    points = json.dumps(DEFAULT_STUDY_POINTS, ensure_ascii=False)
    points = points.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    return Response(
        template.replace("__STUDY_POINTS_JSON__", points),
        content_type="text/html; charset=utf-8",
    )


@site_bp.get("/admin")
def management_login():
    if current_user.is_authenticated:
        if current_user.cargo not in {Cargo.ADMINISTRADOR, Cargo.ENGENHEIRO}:
            flash("A área de gestão é restrita à equipe autorizada.", "error")
            logout_user()
            return redirect(url_for("auth.login", next=url_for("main.dashboard")))
        return redirect(url_for("main.dashboard"))
    return redirect(url_for("auth.login", next=url_for("main.dashboard")))


@site_bp.get("/assets/simulador3d.js")
def simulator_script():
    return send_from_directory(SIMULATOR_JS, "simulador3d.js")


@site_bp.get("/api/posts")
def public_posts():
    publicacoes = db.session.scalars(
        db.select(Publicacao).order_by(Publicacao.criada_em.desc(), Publicacao.id.desc()).limit(12)
    ).all()
    posts = []
    for publicacao in publicacoes:
        criada_em = publicacao.criada_em
        if criada_em.tzinfo is None:
            criada_em = criada_em.replace(tzinfo=timezone.utc)
        posts.append(
            {
                "id": publicacao.id,
                "title": publicacao.titulo,
                "body": publicacao.texto,
                "image_url": "",
                "created_at": criada_em.isoformat(),
            }
        )
    return jsonify(posts=posts)
