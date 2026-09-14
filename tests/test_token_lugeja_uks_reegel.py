"""Prosopograafia ei loe kutsujat oma reegli järgi (#356).

`server/prosopography/router.py`-l oli oma `_optional_user`, mis luges tokeni
AINULT `?token=` query-parameetrist. Klient saadab tokeni `Authorization`-päises
(`getAuthHeaders`), seega tagastas see päris kasutaja päringul alati `None`.
Viga ei olnud nähtav, sest kõigis kolmes kasutuskohas oli parameeter kasutamata —
aga järgmine `if is_at_least(user["role"], ...)` oleks saanud vaikselt anonüümse
käitumise.

Valvur on struktuurne meelega: funktsionaalset katvust (päise-token jõuab
kutsujani) annab `test_persons_work_set_filter.py`, aga see katab ainult
`_resolve_work_set_ids`-i. Järgmine kloon tekiks mujal, ja ainus ühine tunnus
on „loeb tokenit query-st, aga ei vaata päist".
"""
import ast
from pathlib import Path

ROUTER = Path(__file__).resolve().parents[1] / "server" / "prosopography" / "router.py"


def _loeb_query_tokenit(fn: ast.FunctionDef) -> bool:
    """Kas funktsioon kutsub `request.query_params.get("token")`?"""
    for node in ast.walk(fn):
        if not isinstance(node, ast.Call):
            continue
        f = node.func
        if not (isinstance(f, ast.Attribute) and f.attr == "get"):
            continue
        if not (isinstance(f.value, ast.Attribute) and f.value.attr == "query_params"):
            continue
        if node.args and isinstance(node.args[0], ast.Constant) and node.args[0].value == "token":
            return True
    return False


def _loeb_authorization_paist(fn: ast.FunctionDef) -> bool:
    """Kas funktsioon puudutab kusagil `Authorization`-stringi?

    `_get_user` läbib valvuri just siin: query on seal tagavaratee (`<img src>`
    tüüpi GET-id), mitte ainus tee. Reegel ei ole „query on keelatud", vaid
    „query-tee kõrval peab olema ka päise-tee".
    """
    return any(
        isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and node.value.lower() == "authorization"
        for node in ast.walk(fn)
    )


def _funktsioonid():
    puu = ast.parse(ROUTER.read_text(encoding="utf-8"))
    return [n for n in ast.walk(puu)
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]


def test_prosopograafia_ei_loe_tokenit_ainult_queryst():
    """Query-only token-lugeja on vaikne ligipääsu-eitus: klient saadab päise."""
    süüdlased = [
        fn.name for fn in _funktsioonid()
        if _loeb_query_tokenit(fn)
        and not _loeb_authorization_paist(fn)
    ]
    assert süüdlased == [], (
        "Need funktsioonid loevad tokeni query-st, aga ei vaata Authorization-päist: "
        f"{süüdlased}. Klient saadab tokeni päises (getAuthHeaders) → tulemus on "
        "vaikne `None`. Kasuta `server.deps.optional_user`-it (vt #356)."
    )


def test_prosopograafial_ei_ole_oma_optional_user_lugejat():
    """`deps.py` on auth-dependency'de üks tõene allikas (CLAUDE.md)."""
    import server.prosopography.router as router

    assert not hasattr(router, "_optional_user"), (
        "`_optional_user` on `deps.optional_user`-i dubleering, mis lahknes (#356). "
        "Kutsuja loetakse `server.deps.optional_user`-iga."
    )
