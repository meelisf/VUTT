"""ADR 0077 migratsiooniplaan: põhikiri, otsustamata, manifestipõhine idempotentsus."""
import importlib.util
import os

from server.script_migration import text_hash

_spec = importlib.util.spec_from_file_location(
    "migrate_cs_to_f", os.path.join(os.path.dirname(__file__), "..", "scripts", "migrate_cs_to_f.py"))
mig = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mig)


def test_antiikvateos_signaalist():
    status, base, source, plans, _ = mig.plan_work("w", {"a.txt": "ex-\nemplum <cs>Gott</cs>"}, None, None)
    assert (status, base, source) == ("convert", "A", "signaal")
    assert plans["a.txt"] == "ex-\nemplum <f>Gott</f>"


def test_antiikvateos_ilma_cs_ita_noop():
    assert mig.plan_work("w", {"a.txt": "ex-\nemplum"}, None, None)[0] == "noop"


def test_fraktuurteos_ka_cs_ita_leht_teisendub():
    status, base, _, plans, _ = mig.plan_work("w", {"a.txt": "vnd Ge⸗\nwitter", "b.txt": "Text"}, None, None)
    assert (status, base) == ("convert", "F")
    assert plans["b.txt"] == "<f>Text</f>"


def test_vastuolu_cs_iga_on_otsustamata_otsus_voidab():
    texts = {"a.txt": "Ge⸗\nx <cs>y</cs>", "b.txt": "ex-\nz"}
    assert mig.plan_work("w", texts, None, None)[0] == "undecided"
    status, base, source, _, _ = mig.plan_work("w", texts, "F", None)
    assert (status, base, source) == ("convert", "F", "käsitsi")


def test_signaalita_cs_ita_ei_muutu():
    assert mig.plan_work("w", {"a.txt": "kein Signal"}, None, None)[0] == "no_signal"


def test_korduskaivitus_manifestiga_ei_teisenda_topelt():
    # Fraktuurteose antiikvaleht: <cs>ABC</cs> → ABC. <f>-i ei ole, aga manifest teab.
    entry = {"base": "F", "source": "signaal", "pages": {
        "a.txt": {"in": text_hash("<cs>ABC</cs>"), "out": text_hash("ABC")}}}
    assert mig.plan_work("w", {"a.txt": "ABC"}, None, entry)[0] == "noop"


def test_korduskaivitus_teisendab_hilisema_cs_lehe():
    entry = {"base": "F", "source": "signaal", "pages": {}}
    status, _, _, plans, _ = mig.plan_work("w", {"a.txt": "Text <cs>Deus</cs>", "b.txt": "Text"}, None, entry)
    assert status == "convert"
    assert plans == {"a.txt": "<f>Text</f> Deus"}  # b.txt-l <cs>-i ei ole → ei puudutata


def _fake_git(monkeypatch, tmp_path):
    import server.git_ops as git_ops
    import server.script_migration as sm
    commits = []
    monkeypatch.setattr(git_ops, "save_with_git",
                        lambda *a, **kw: commits.append((a, kw)) or {"commit_hash": "abc12345"})
    monkeypatch.setattr(mig, "MANIFEST_PATH", str(tmp_path / "config" / "migrations" / "0077-f.json"))
    monkeypatch.setattr(sm, "MANIFEST_PATH", str(tmp_path / "config" / "migrations" / "0077-f.json"))
    return commits


def test_apply_lehed_ja_manifest_uhes_commitis(tmp_path, monkeypatch):
    commits = _fake_git(monkeypatch, tmp_path)
    (tmp_path / "a.txt").write_text("Text", encoding="utf-8")
    manifest = {"version": 1, "works": {}}
    res = mig.apply_work(str(tmp_path), "w1", "F", "signaal", {"a.txt": "Text"}, {"a.txt": "<f>Text</f>"}, manifest)
    assert res["written"] == 1 and len(commits) == 1
    (first, text, author), kw = commits[0]
    assert author == "Automaatne" and text == "<f>Text</f>"
    manifest_path, manifest_json = kw["additional_files"][-1]
    assert manifest_path.endswith("0077-f.json")
    import json
    saved = json.loads(manifest_json)["works"]["w1"]
    assert saved["base"] == "F" and saved["pages"]["a.txt"]["out"] == text_hash("<f>Text</f>")
    assert "migrated_at" in saved


def test_apply_vahepeal_muutunud_leht_jaab_manifestist_valja(tmp_path, monkeypatch):
    commits = _fake_git(monkeypatch, tmp_path)
    (tmp_path / "a.txt").write_text("toimetaja uus", encoding="utf-8")
    manifest = {"version": 1, "works": {}}
    res = mig.apply_work(str(tmp_path), "w1", "F", "signaal", {"a.txt": "Text"}, {"a.txt": "<f>Text</f>"}, manifest)
    assert res == {"written": 0, "raced": ["a.txt"], "commit": None}
    assert commits == []
    assert (tmp_path / "a.txt").read_text(encoding="utf-8") == "toimetaja uus"


def test_segateos_lehe_kaupa():
    texts = {
        "de.txt": "Dort dein Tisbit <cs>expostulirte</cs>/ Kir⸗\nchen",
        "la.txt": "Thesis ex-\nemplum <cs>Een Juugfru</cs>",
        "x.txt": "<cs>Darff</cs> sich",          # signaalita
        "plain.txt": "Text ohne cs",               # <cs>-ita → puutumata
    }
    status, base, _, plans, extra = mig.plan_work("w", texts, "P", None)
    assert (status, base) == ("convert", "P")
    assert plans["de.txt"] == "<f>Dort dein Tisbit</f> expostulirte<f>/ Kir⸗</f>\n<f>chen</f>"
    assert plans["la.txt"] == "Thesis ex-\nemplum <f>Een Juugfru</f>"
    assert "plain.txt" not in plans
    assert extra == {"unresolved": ["x.txt"]}
    _, _, _, plans2, extra2 = mig.plan_work("w", texts, "P", None, {"x.txt": "F"})
    assert plans2["x.txt"] == "Darff <f>sich</f>" and extra2 == {"unresolved": []}


def test_kasikirja_cs_esiletostuks_voi_valja():
    t = "mit Leib u. Seel. <cs>Kangro Jaan</cs>."
    assert mig.manuscript_cs(t, "hi") == "mit Leib u. Seel. <hi>Kangro Jaan</hi>."
    assert mig.manuscript_cs(t, "strip") == "mit Leib u. Seel. Kangro Jaan."


def test_vastuoluline_signaal_cs_ita_on_otsustamata():
    texts = {"a.txt": "Ge⸗\nx", "b.txt": "ex-\ny"}
    assert mig.plan_work("w", texts, None, None)[0] == "undecided"


def test_segateos_cs_ita_leht_lehe_signaalist():
    texts = {"de.txt": "Klag vnd Ge⸗\nwitter", "la.txt": "ex-\nemplum", "mix.txt": "Ge⸗\nex-\nx"}
    status, _, _, plans, extra = mig.plan_work("w", texts, "P", None)
    assert plans == {"de.txt": "<f>Klag vnd Ge⸗</f>\n<f>witter</f>"}
    assert extra == {"unresolved": ["mix.txt"]}
