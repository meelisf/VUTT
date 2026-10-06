"""ADR 0062 samm 5: korpuse migratsiooni plaan ja CAS."""
import importlib.util
import json
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "migrate_macron_corpus",
    Path(__file__).resolve().parent.parent / "scripts" / "migrate_macron_corpus.py",
)
mig = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mig)


def test_ladina_tilde_teisendatakse():
    kind, new, n = mig.plan_page("cũ nõ", ["lat"])
    assert kind == "convert" and new == "cū nō" and n == 2


def test_valvuriga_keel_ei_teisenda_aga_raporteerib():
    kind, new, words = mig.plan_page("sõna cũ", ["lat", "est"])
    assert kind == "guarded" and new is None and words == ["sõna", "cũ"]


def test_ainult_nfc_muutus_ei_ole_teisendus():
    """NFD-kujul tekst ilma tildeta → leht jääb puutumata (ADR 0012)."""
    assert mig.plan_page("café", ["lat"])[0] == "skip"


def test_kreeka_tilde_jaab():
    assert mig.plan_page("τῶν", ["grc"])[0] == "skip"


def test_lehed_ainult_pildiga_paarid(tmp_path):
    (tmp_path / "a.txt").write_text("x")
    (tmp_path / "a.jpg").write_bytes(b"")
    (tmp_path / "notes.txt").write_text("x")
    assert [Path(p).name for p in mig.page_txts(str(tmp_path))] == ["a.txt"]


def test_vahepeal_muutunud_leht_jaetakse_vahele(tmp_path, monkeypatch):
    """CAS: toimetaja salvestas pärast plaani — tema tekst jääb alles."""
    import server.git_ops as git_ops
    commits = []
    monkeypatch.setattr(git_ops, "save_with_git",
                        lambda *a, **kw: commits.append(a) or {"commit_hash": "abc12345"})
    txt = tmp_path / "p1.txt"
    txt.write_text("toimetaja uus tekst cũ", encoding="utf-8")
    res = mig.apply_work(str(tmp_path), {str(txt): ("vana cũ", "vana cū")})
    assert res == {"written": 0, "raced": ["p1.txt"], "commit": None}
    assert commits == []
    assert txt.read_text(encoding="utf-8") == "toimetaja uus tekst cũ"


def test_muutumata_leht_kirjutatakse_uhe_commitiga(tmp_path, monkeypatch):
    import server.git_ops as git_ops
    commits = []
    monkeypatch.setattr(git_ops, "save_with_git",
                        lambda *a, **kw: commits.append((a, kw)) or {"commit_hash": "abc12345"})
    plans = {}
    for i in (1, 2):
        p = tmp_path / f"p{i}.txt"
        p.write_text("cũ", encoding="utf-8")
        plans[str(p)] = ("cũ", "cū")
    res = mig.apply_work(str(tmp_path), plans)
    assert res["written"] == 2 and len(commits) == 1
    (first, text, author), kw = commits[0]
    assert author == "Automaatne" and text == "cū" and len(kw["additional_files"]) == 1
