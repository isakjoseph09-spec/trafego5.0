from flask import Blueprint, render_template, request


teste_pratico_bp = Blueprint("teste_pratico", __name__)


@teste_pratico_bp.get("/teste-na-pratica")
def teste_na_pratica():
    if request.args.get("embed") == "1":
        return render_template("teste_pratico_embed.html")
    return render_template("teste_pratico.html")
