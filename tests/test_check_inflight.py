"""Deploy-valve: mis on lennus, enne kui backend maha võetakse (#257).

Tootmises 2026-08-24 tappis deploy kasutaja poolelioleva upload'i (59 MB PDF,
33 lehe eelvaade, 27 poolitusotsust). Deploy'ja oli kontrollinud
`reocr_active.json`-i ja **unustanud uploadid** — mõlemat käsitsi meeles pidada
ei tööta.

Skript loeb AINULT faile (mitte API-t), sest ta peab töötama ka siis, kui
backend on maas või kinni.
"""
import importlib.util
import json
import os

# `scripts/` ei ole pakett — sama laadimismuster nagu `test_fix_ada_creators_role.py`.
_SPEC = importlib.util.spec_from_file_location(
    "check_inflight",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                 "scripts", "check_inflight.py"),
)
_MOD = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_MOD)

leia_lennus_olevad = _MOD.leia_lennus_olevad


def _uploads(tmp_path, **staatused):
    d = tmp_path / "uploads"
    d.mkdir(exist_ok=True)
    for uid, st in staatused.items():
        (d / uid).mkdir(exist_ok=True)
        (d / uid / "state.json").write_text(
            json.dumps({"id": uid, "status": st, "created_at": "2026-08-24T13:37:52"}),
            encoding="utf-8")
    return d


def _reocr(tmp_path, tood):
    d = tmp_path / "state"
    d.mkdir(exist_ok=True)
    (d / "reocr_active.json").write_text(json.dumps(tood), encoding="utf-8")
    return d


def test_puhas_seis_ei_leia_midagi(tmp_path):
    _uploads(tmp_path, a="done", b="imported", c="error")
    _reocr(tmp_path, [])
    assert leia_lennus_olevad(str(tmp_path)) == []


def test_applying_upload_peatab_deploy(tmp_path):
    """Täpselt see juhtum, mis 2026-08-24 kasutaja töö maha võttis."""
    _uploads(tmp_path, pq5jeb="applying")
    _reocr(tmp_path, [])
    leiud = leia_lennus_olevad(str(tmp_path))
    assert len(leiud) == 1
    assert "pq5jeb" in leiud[0]
    assert "applying" in leiud[0]


def test_ka_processing_ja_collecting_images_loevad(tmp_path):
    """Kõik kolm on „töö on lennus": lõime tapmine kaotab kasutaja tööd."""
    _uploads(tmp_path, a="processing", b="collecting_images")
    _reocr(tmp_path, [])
    assert len(leia_lennus_olevad(str(tmp_path))) == 2


def test_aktiivne_reocr_peatab_deploy(tmp_path):
    _uploads(tmp_path)
    _reocr(tmp_path, [{"job_id": "j1", "status": "processing", "work_id": "w1"}])
    leiud = leia_lennus_olevad(str(tmp_path))
    assert len(leiud) == 1
    assert "j1" in leiud[0]


def test_lopetatud_reocr_ei_peata(tmp_path):
    _uploads(tmp_path)
    _reocr(tmp_path, [{"job_id": "j1", "status": "done", "work_id": "w1"}])
    assert leia_lennus_olevad(str(tmp_path)) == []


def test_katkine_fail_ei_vaiki_valvet(tmp_path):
    """Loetamatu state.json EI TOHI anda rohelist tuld.

    Vaikne „ei leidnud midagi" on siin halvim võimalik vastus: valve mõte on
    öelda, et me EI TEA, kas midagi on lennus.
    """
    d = _uploads(tmp_path, hea="applying")
    (d / "katki").mkdir()
    (d / "katki" / "state.json").write_text("{ see ei ole json", encoding="utf-8")
    _reocr(tmp_path, [])
    leiud = leia_lennus_olevad(str(tmp_path))
    assert len(leiud) == 2
    assert any("katki" in r for r in leiud), leiud


def test_puuduv_reocr_fail_on_normaalne(tmp_path):
    """Faili puudumine tähendab „ühtki tööd pole olnud", mitte viga."""
    _uploads(tmp_path, a="done")
    (tmp_path / "state").mkdir()
    assert leia_lennus_olevad(str(tmp_path)) == []


def test_ajavoondita_aeg_on_utc():
    """Konteiner kirjutab ajavööndita UTC-aja, skript jookseb EET hostis (2026-11-19:
    9 minutit kestnud upload paistis „2 h 9 min")."""
    from datetime import datetime, timedelta, timezone
    praegu = datetime(2026, 11, 19, 14, 40, 50, tzinfo=timezone.utc)
    assert _MOD._vanus("2026-11-19T14:31:47.190977", praegu) == "9 min"
    # Ajavööndiga aeg (Z või nihe) arvestab nihet.
    assert _MOD._vanus("2026-11-19T14:31:47Z", praegu) == "9 min"
    assert _MOD._vanus("2026-11-19T16:31:47+02:00", praegu) == "9 min"
    assert _MOD._vanus((praegu - timedelta(hours=3, minutes=5)).replace(tzinfo=None).isoformat(),
                       praegu) == "3 h 5 min"
    assert _MOD._vanus("katki", praegu) == "aeg teadmata"
    assert _MOD._vanus(None, praegu) == "aeg teadmata"
    # Ilma `praegu`-ta võrdleb UTC kellaga: just loodud aeg ei ole tundide vanune.
    assert _MOD._vanus(datetime.now(timezone.utc).replace(tzinfo=None).isoformat()) == "alla minuti"
