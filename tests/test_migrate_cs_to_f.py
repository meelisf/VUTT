"""ADR 0077 migratsiooniplaan: keelepõhine põhikiri, otsused, manifestipõhine idempotentsus."""
import importlib.util
import json
import os

from server.script_migration import text_hash

_spec = importlib.util.spec_from_file_location(
    "migrate_cs_to_f", os.path.join(os.path.dirname(__file__), "..", "scripts", "migrate_cs_to_f.py"))
mig = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mig)

DE = "vnd die Welt ist nicht mit dem Herrn"
LA = "Quod est in corpore et non sine Deo"


def test_keel_maarab_lehe_kaupa():
    plans, infos = mig.plan_work({"de.txt": DE, "la.txt": LA, "cs.txt": f"{LA} <cs>Gott</cs>"}, {})
    assert plans["de.txt"] == f"<f>{DE}</f>"
    assert "la.txt" not in plans and infos["la.txt"]["kind"] == "antiqua"
    assert plans["cs.txt"] == f"{LA} <f>Gott</f>"


def test_teose_varuvariant_ainult_tundmatu_keele_korral():
    plans, infos = mig.plan_work({"x.txt": "Xyz <cs>abc</cs>", "de.txt": DE}, {}, decision="A")
    assert infos["x.txt"]["base"] == "A" and plans["x.txt"] == "Xyz <f>abc</f>"
    assert plans["de.txt"] == f"<f>{DE}</f>"  # keel võidab varuvariandi


def test_kova_otsus_kirjutab_keele_ule():
    plans, infos = mig.plan_work({"de.txt": DE}, {}, decision="A!")
    assert "de.txt" not in plans and infos["de.txt"]["kind"] == "antiqua"


def test_lehe_otsus_voidab():
    plans, _ = mig.plan_work({"la.txt": LA}, {}, page_decisions={"la.txt": "F"})
    assert plans["la.txt"] == f"<f>{LA}</f>"


def test_ulevaatuse_pohjused():
    _, infos = mig.plan_work({"x.txt": "Xyz <cs>abc</cs>"}, {})
    assert mig.needs_review(infos["x.txt"]) == "keel tundmatu"


def test_korduskaivitus_manifestiga_ei_teisenda_topelt():
    entry = {"pages": {"a.txt": {"in": text_hash("<cs>ABC</cs>"), "out": text_hash("ABC")}}}
    assert mig.plan_work({"a.txt": "ABC"}, {}, entry=entry) == ({}, {})


def test_korduskaivitus_ainult_cs_lehed():
    plans, _ = mig.plan_work({"a.txt": f"{LA} <cs>Deus</cs>", "b.txt": DE}, {}, entry={"pages": {}})
    assert set(plans) == {"a.txt"}


def test_otsuste_fail(tmp_path):
    p = tmp_path / "o.json"
    p.write_text(json.dumps({"w1": "a!", "w2": "F", "w1/x.txt": "A", "w3": "Q"}))
    d, pd, bad = mig.load_decisions(str(p))
    assert d == {"w1": "A!", "w2": "F", "w3": "Q"} and pd == {"w1": {"x.txt": "A"}} and bad == {"w3": "Q"}


def test_kasikirja_cs_esiletostuks_voi_valja():
    t = "mit Leib u. Seel. <cs>Kangro Jaan</cs>."
    assert mig.manuscript_cs(t, "hi") == "mit Leib u. Seel. <hi>Kangro Jaan</hi>."
    assert mig.manuscript_cs(t, "strip") == "mit Leib u. Seel. Kangro Jaan."


def _fake_git(monkeypatch, tmp_path):
    import server.git_ops as git_ops
    commits = []
    monkeypatch.setattr(git_ops, "save_with_git",
                        lambda *a, **kw: commits.append((a, kw)) or {"commit_hash": "abc12345"})
    monkeypatch.setattr(mig, "MANIFEST_PATH", str(tmp_path / "config" / "migrations" / "0077-f.json"))
    return commits


def test_apply_lehed_ja_manifest_uhes_commitis(tmp_path, monkeypatch):
    commits = _fake_git(monkeypatch, tmp_path)
    (tmp_path / "a.txt").write_text(DE, encoding="utf-8")
    manifest = {"version": 1, "works": {}}
    infos = {"a.txt": {"base": "F", "kind": "whole"}}
    res = mig.apply_work(str(tmp_path), "w1", {"a.txt": DE}, {"a.txt": f"<f>{DE}</f>"}, infos, manifest)
    assert res["written"] == 1 and len(commits) == 1
    (first, text, author), kw = commits[0]
    assert author == "Automaatne" and text == f"<f>{DE}</f>"
    manifest_path, manifest_json = kw["additional_files"][-1]
    saved = json.loads(manifest_json)["works"]["w1"]
    assert manifest_path.endswith("0077-f.json") and "migrated_at" in saved
    assert saved["pages"]["a.txt"] == {"in": text_hash(DE), "out": text_hash(f"<f>{DE}</f>"),
                                       "base": "F", "kind": "whole"}


def test_apply_vahepeal_muutunud_leht_jaab_valja(tmp_path, monkeypatch):
    commits = _fake_git(monkeypatch, tmp_path)
    (tmp_path / "a.txt").write_text("toimetaja uus", encoding="utf-8")
    res = mig.apply_work(str(tmp_path), "w1", {"a.txt": DE}, {"a.txt": f"<f>{DE}</f>"},
                         {"a.txt": {"base": "F", "kind": "whole"}}, {"version": 1, "works": {}})
    assert res == {"written": 0, "raced": ["a.txt"], "commit": None}
    assert commits == []


def test_kasikirjaline_leht_trukises():
    plans, infos = mig.plan_work({"m.txt": "R Acad. Born. 1697: 32\n<cs>koopia: Lund UB</cs>"}, {},
                                 page_decisions={"m.txt": "H"})
    assert plans["m.txt"] == "R Acad. Born. 1697: 32\n<hi>koopia: Lund UB</hi>"
    assert infos["m.txt"]["kind"] == "manuscript" and not mig.needs_review(infos["m.txt"])
