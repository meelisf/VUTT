"""Kalle, kärbe ja perspektiiv upload'i ülevaatuses (#431, etapp 2).

`adjust` elab plaanis nagu `rotate` ja kasutab SAMA teisendust
(`server/image_transform.py`) nagu teose halduse pildiredaktor — nii annab
sama kast mõlemal teel sama pildi. Järjekord apply's: pööre → adjust →
poolitus, seega `split_x` on osa kohandatud lehe laiusest.
"""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import image_transform
from server.upload import prepress_apply, prepress_plan, state as upload_state

POOLE_KARBE = {"angle": 0, "crop": {"x": 0.0, "y": 0.0, "w": 0.5, "h": 1.0}, "quad": None}


# --- normalize_adjust: salvestuse valvur ---

def test_tyhi_adjust_on_none():
    """Tühi kest ei tohi plaani jääda — see keelaks baitkoopia ilma põhjuseta."""
    assert image_transform.normalize_adjust(None) is None
    assert image_transform.normalize_adjust({"angle": 0, "crop": None, "quad": None}) is None
    assert image_transform.normalize_adjust({"angle": 0.00001}) is None


def test_karbe_normaliseeritakse():
    a = image_transform.normalize_adjust({"angle": "1.5", "crop": {"x": 0, "y": 0.1, "w": 0.5, "h": 0.8}})
    assert a == {"angle": 1.5, "crop": {"x": 0.0, "y": 0.1, "w": 0.5, "h": 0.8}, "quad": None}


def test_quad_normaliseeritakse_listiks():
    q = [{"x": 0.1, "y": 0.1}, {"x": 0.9, "y": 0.1}, {"x": 0.9, "y": 0.9}, {"x": 0.1, "y": 0.9}]
    a = image_transform.normalize_adjust({"quad": q})
    assert a["quad"] == [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]]
    assert a["crop"] is None


@pytest.mark.parametrize("vigane", [
    "kärbe",
    {"angle": "nurk"},
    {"angle": float("nan")},
    {"angle": 1000},
    {"crop": {"x": 0, "y": 0, "w": 1.5, "h": 1}},
    {"crop": {"x": 0, "y": 0, "w": 0, "h": 1}},
    {"crop": {"x": 0, "y": 0, "w": 0.5}},
    {"crop": {"x": 0, "y": 0, "w": 0.5, "h": 0.5},
     "quad": [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]]},
    {"quad": [[0.1, 0.1], [0.9, 0.9], [0.9, 0.1], [0.1, 0.9]]},   # bow-tie
])
def test_vigane_adjust_lykatakse_tagasi(vigane):
    with pytest.raises(ValueError):
        image_transform.normalize_adjust(vigane)


def test_adjust_of_talub_vana_ja_vigast_plaani():
    plan = prepress_plan.default_plan(3)
    plan["pages"][1]["adjust"] = POOLE_KARBE
    plan["pages"][2]["adjust"] = {"crop": "katki"}
    assert prepress_plan.adjust_of(plan, 1) is None, "puuduv väli = teisendust ei ole"
    assert prepress_plan.adjust_of(plan, 2)["crop"]["w"] == 0.5
    assert prepress_plan.adjust_of(plan, 3) is None, "vigane salvestis ei tohi apply't kukutada"


# --- Apply: pööre → adjust → poolitus ---

class _SFTP:
    def close(self):
        pass


@pytest.fixture
def apply_env(tmp_path, monkeypatch):
    """Lähteleht 1600×1000."""
    uploads = tmp_path / "uploads"
    (uploads / "u1" / "thumbs").mkdir(parents=True)
    monkeypatch.setattr(upload_state, "UPLOADS_DIR", str(uploads))
    upload_state.write_state("u1", {"id": "u1", "status": "applying", "meta": {"slug": "x"}})

    src = tmp_path / "source.pdf"
    src.write_bytes(b"%PDF-1.4 fake")
    monkeypatch.setattr(prepress_apply.prepress, "source_path", lambda uid: str(src))

    class _Source:
        def page_count(self):
            return 1

        def source_file(self, n):
            return None

        def render_full(self, n, dst):
            from PIL import Image
            Image.new("RGB", (1600, 1000), (120, 120, 160)).save(dst, "JPEG", quality=95)

    monkeypatch.setattr(prepress_apply.page_source, "open_page_source", lambda p: _Source())
    monkeypatch.setattr(prepress_apply.ocr_client, "sftp_open", lambda uid: _SFTP())
    monkeypatch.setattr(prepress_apply.ocr_client, "ensure_remote_dirs", lambda s, d: None)

    avaldatud = []

    def _publish(s, local, remote):
        from PIL import Image
        with Image.open(local) as im:
            avaldatud.append(im.size)

    monkeypatch.setattr(prepress_apply, "publish_atomic", _publish)
    return avaldatud


def _plaan(rotate=0, mode="nosplit", adjust=None):
    return {"default_split_x": 0.5, "pages": [
        {"n": 1, "mode": mode, "split_x": None, "excluded": False,
         "rotate": rotate, "adjust": adjust},
    ]}


def _transfer(plan):
    prepress_apply._transfer_pages("u1", "x", ("/srv/st", "/srv/st/w"), "/srv/st/w", plan)


def test_karbitud_leht_avaldatakse_karbituna(apply_env):
    _transfer(_plaan(adjust=POOLE_KARBE))
    assert apply_env == [(800, 1000)]


def test_karbe_on_POORATUD_lehe_raamis(apply_env):
    """90° järel on leht 1000×1600; pool laiusest = 500, mitte 800."""
    _transfer(_plaan(rotate=90, adjust=POOLE_KARBE))
    assert apply_env == [(500, 1600)]


def test_poolitus_kaib_KARBITUD_laiuse_jargi(apply_env):
    _transfer(_plaan(mode="default", adjust=POOLE_KARBE))
    assert apply_env == [(400, 1000), (400, 1000)]


def test_sama_teisendus_nagu_teose_halduses(apply_env):
    """Kalle laiendab kasti (expand=True) täpselt nagu transform_page_image."""
    from PIL import Image
    oodatud = image_transform.apply_transform(
        Image.new("RGB", (1600, 1000)), angle=3.0).size
    _transfer(_plaan(adjust={"angle": 3.0}))
    assert apply_env == [oodatud]


def test_adjustiga_leht_ei_ole_baitkoopia(tmp_path):
    from PIL import Image
    from server.upload import page_source

    kaust = tmp_path / "source"
    kaust.mkdir()
    Image.new("RGB", (800, 1000)).save(kaust / "lk1.jpg", "JPEG", quality=88)
    src = page_source.open_page_source(str(kaust))

    assert prepress_apply.can_copy_source_bytes(src, _plaan(), 1, 800) is True
    assert prepress_apply.can_copy_source_bytes(src, _plaan(adjust=POOLE_KARBE), 1, 800) is False


# --- Eelvaade: renderdusparameeter ---

def _eelvaade(tmp_path, monkeypatch, size=(700, 500)):
    from PIL import Image
    from server.upload import prepress

    monkeypatch.setattr(prepress.upload_state, "UPLOADS_DIR", str(tmp_path))
    kaust = tmp_path / "u1" / "preview"
    kaust.mkdir(parents=True)
    Image.new("RGB", size).save(kaust / "pg_0003.jpg", "JPEG", quality=80)
    return prepress


def test_adjusted_preview_path_karbib_ja_vahemalustab(tmp_path, monkeypatch):
    from PIL import Image
    prepress = _eelvaade(tmp_path, monkeypatch)

    tee = prepress.adjusted_preview_path("u1", 3, 0, POOLE_KARBE)
    with Image.open(tee) as im:
        assert im.size == (350, 500)
    mtime = Path(tee).stat().st_mtime_ns
    assert prepress.adjusted_preview_path("u1", 3, 0, POOLE_KARBE) == tee
    assert Path(tee).stat().st_mtime_ns == mtime, "teist korda ei renderdata"


def test_adjusted_preview_path_poorab_enne_karbet(tmp_path, monkeypatch):
    from PIL import Image
    prepress = _eelvaade(tmp_path, monkeypatch)

    with Image.open(prepress.adjusted_preview_path("u1", 3, 90, POOLE_KARBE)) as im:
        assert im.size == (250, 700)


def test_adjusted_preview_path_ilma_adjustita_on_pooratud_eelvaade(tmp_path, monkeypatch):
    prepress = _eelvaade(tmp_path, monkeypatch)
    assert prepress.adjusted_preview_path("u1", 3, 90, None) == \
        prepress.rotated_preview_path("u1", 3, 90)


# --- Endpointid ---

def _auth(login):
    return {"Authorization": "Bearer {}".format(login("admin", "adminpass"))}


def test_salvestus_hoiab_adjusti_ja_vana_klient_ei_pyhi_seda(client, login, make_upload):
    from server.upload import state as st

    make_upload("upl950", status="awaiting_split", expected_pages=1)
    st.set_upload_state("upl950", prepress=prepress_plan.default_plan(1))
    h = _auth(login)
    lk = {"n": 1, "mode": "nosplit", "split_x": None, "excluded": False, "rotate": 0}

    r = client.post("/admin/upload/upl950/prepress", headers=h,
                    json={"default_split_x": 0.5, "pages": [dict(lk, adjust=POOLE_KARBE)]})
    assert r.status_code == 200
    assert prepress_plan.adjust_of(st.read_state("upl950")["prepress"], 1)["crop"]["w"] == 0.5

    # Vanem klient (vahemälus JS) ei saada välja üldse → kärbe jääb alles.
    r = client.post("/admin/upload/upl950/prepress", headers=h,
                    json={"default_split_x": 0.5, "pages": [lk]})
    assert r.status_code == 200
    assert prepress_plan.adjust_of(st.read_state("upl950")["prepress"], 1) is not None

    # Selgesõnaline null eemaldab.
    r = client.post("/admin/upload/upl950/prepress", headers=h,
                    json={"default_split_x": 0.5, "pages": [dict(lk, adjust=None)]})
    assert r.status_code == 200
    assert prepress_plan.adjust_of(st.read_state("upl950")["prepress"], 1) is None


def test_salvestus_lykkab_vigase_adjusti_tagasi(client, login, make_upload):
    from server.upload import state as st

    make_upload("upl951", status="awaiting_split", expected_pages=1)
    st.set_upload_state("upl951", prepress=prepress_plan.default_plan(1))
    r = client.post("/admin/upload/upl951/prepress", headers=_auth(login), json={
        "default_split_x": 0.5,
        "pages": [{"n": 1, "mode": "nosplit", "excluded": False, "rotate": 0,
                   "adjust": {"crop": {"x": 0, "y": 0, "w": 2, "h": 1}}}],
    })
    assert r.status_code == 400


def test_eelvaate_endpoint_vigane_adj_on_400(client, login, make_upload, monkeypatch):
    from server.upload import prepress

    make_upload("upl952", status="awaiting_split", expected_pages=1)
    monkeypatch.setattr(prepress.os.path, "isfile", lambda p: True)
    h = _auth(login)
    for adj in ("{katki", json.dumps({"crop": {"x": 0, "y": 0, "w": 2, "h": 1}})):
        r = client.get("/admin/upload/upl952/preview/1", headers=h, params={"adj": adj})
        assert r.status_code == 400, adj
