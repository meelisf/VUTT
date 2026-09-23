"""Õigusvälja kirjutus katkestab sessiooni (#356 punkt 4, ADR 0046).

Sessioon on kutsuja õiguste ainus tõde: `get_user` ja `optional_user` loevad
mõlemad sessiooni hetktõmmist. See kehtib ainult siis, kui iga
`allowed_collections` / `edit_collections` kirjutus katkestab muutunud
kasutaja sessioonid — muidu jääks vana õigus kuni 24 h kehtima.

Valvur on struktuurne: funktsioon, mis puudutab õigusvälja nime JA kutsub
`save_users`-it, peab kutsuma ka `delete_user_sessions`-it või olema allpool
põhjendatud erand.
"""
import ast
from pathlib import Path

SERVER = Path(__file__).resolve().parents[1] / "server"
VALJAD = {"allowed_collections", "edit_collections"}

# funktsioon → põhjus, miks ta ise sessiooni ei katkesta
ERANDID = {
    "create_user_from_invite": "uus konto — sessioone ei ole veel olemas",
    "_cleanup_collection_from_users": "tagastab muutunud nimed, KUTSUJA invalideerib "
                                      "(kontrollitud allpool)",
}


def _funktsioonid():
    for tee in SERVER.rglob("*.py"):
        puu = ast.parse(tee.read_text(encoding="utf-8"))
        for fn in ast.walk(puu):
            if isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
                yield tee, fn


def _kutsed(fn):
    return {getattr(n.func, "id", getattr(n.func, "attr", None))
            for n in ast.walk(fn) if isinstance(n, ast.Call)}


def _puudutab_oigusvalja(fn):
    return any(isinstance(n, ast.Constant) and n.value in VALJAD for n in ast.walk(fn))


def test_iga_oigusvalja_kirjutaja_katkestab_sessiooni():
    rikkujad = [
        f"{tee.relative_to(SERVER.parent)}:{fn.lineno} {fn.name}"
        for tee, fn in _funktsioonid()
        if _puudutab_oigusvalja(fn)
        and "save_users" in _kutsed(fn)
        and "delete_user_sessions" not in _kutsed(fn)
        and fn.name not in ERANDID
    ]
    assert rikkujad == [], (
        "Need kirjutavad õigusvälja, aga ei katkesta sessiooni: "
        f"{rikkujad}. Sessioon on õiguste ainus tõde (ADR 0046) — kutsu "
        "`delete_user_sessions` luku VÄLJAS, üks kord kasutaja kohta."
    )


def test_erandid_on_elus():
    """Erand, mida koodis enam ei ole, peidaks tulevase samanimelise rikkuja."""
    nimed = {fn.name for _, fn in _funktsioonid()}
    assert set(ERANDID) <= nimed


def test_kogu_kustutamise_kutsuja_katkestab_sessioonid():
    kutsujad = [fn for _, fn in _funktsioonid()
                if "_cleanup_collection_from_users" in _kutsed(fn)
                and fn.name != "_cleanup_collection_from_users"]
    assert kutsujad, "kogu kustutamine ei kutsu enam koristust?"
    for fn in kutsujad:
        assert "delete_user_sessions" in _kutsed(fn), fn.name
