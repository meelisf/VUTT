"""Lehe pööramine ülevaatuses, enne OCR-i saatmist.

Külili skannitud leht (lahtivolditud ümbrik: kiri püsti, aadress laiuti) kukub
OCR-is läbi. Pööre elab PLAANIS nagu `split_x` ja `excluded` — lähte-PDF ja
eelvaate fail jäävad puutumata.

Järjekord on siin kogu asja tuum: apply pöörab ENNE lõikamist, seega `page_cuts`
saab juba pööratud laiuse ja ülejäänud geomeetria ei tea pöördest midagi.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server.upload import prepress_apply, prepress_plan, state as upload_state


# --- Plaani leping ---

def test_vaikeplaanis_on_poore_null():
    plan = prepress_plan.default_plan(2)
    assert all(p["rotate"] == 0 for p in plan["pages"])


def test_rotate_of_annab_nurga():
    plan = prepress_plan.default_plan(2)
    plan["pages"][0]["rotate"] = 90
    assert prepress_plan.rotate_of(plan, 1) == 90
    assert prepress_plan.rotate_of(plan, 2) == 0


def test_rotate_of_talub_vana_plaani_ilma_valjata():
    """Pooleliolev upload ei tohi katkeda välja lisandumisest."""
    plan = {"default_split_x": 0.5, "pages": [
        {"n": 1, "mode": "nosplit", "split_x": None, "excluded": False},
    ]}
    assert prepress_plan.rotate_of(plan, 1) == 0


def test_normalize_rotate_normaliseerib_nurga():
    assert prepress_plan.normalize_rotate(0) == 0
    assert prepress_plan.normalize_rotate(90) == 90
    assert prepress_plan.normalize_rotate(360) == 0
    assert prepress_plan.normalize_rotate(-90) == 270
    assert prepress_plan.normalize_rotate(450) == 90


def test_normalize_rotate_lykkab_vigase_nurga_tagasi():
    """Ainult 90° kordsed — 45° pööre nõuaks servade täitmist ja pole vajadust."""
    for vigane in (45, 1, "90", None, 91):
        with pytest.raises(ValueError):
            prepress_plan.normalize_rotate(vigane)


# --- Apply: pööre ENNE lõikamist ---

class _SFTP:
    def close(self):
        pass


@pytest.fixture
def apply_env(tmp_path, monkeypatch):
    """Lähtelehed on LAIUTI (1600×1000) — pööre teeb neist püstised."""
    uploads = tmp_path / "uploads"
    (uploads / "u1" / "thumbs").mkdir(parents=True)
    monkeypatch.setattr(upload_state, "UPLOADS_DIR", str(uploads))
    upload_state.write_state("u1", {"id": "u1", "status": "applying",
                                    "meta": {"slug": "x"}})

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

    monkeypatch.setattr(prepress_apply.page_source, "open_page_source",
                        lambda p: _Source())
    monkeypatch.setattr(prepress_apply.ocr_client, "sftp_open", lambda uid: _SFTP())
    monkeypatch.setattr(prepress_apply.ocr_client, "ensure_remote_dirs",
                        lambda s, d: None)

    avaldatud = []
    monkeypatch.setattr(prepress_apply, "publish_atomic",
                        lambda s, local, remote: avaldatud.append(
                            _moodud(local) + (remote,)))
    return avaldatud


def _moodud(path):
    from PIL import Image
    with Image.open(path) as im:
        return im.size


def _plaan(rotate=0, mode="nosplit"):
    return {"default_split_x": 0.5, "pages": [
        {"n": 1, "mode": mode, "split_x": None, "excluded": False, "rotate": rotate},
    ]}


def test_poorata_leht_avaldatakse_pooratuna(apply_env):
    avaldatud = apply_env

    prepress_apply._transfer_pages(
        "u1", "x", ("/srv/st", "/srv/st/w"), "/srv/st/w", _plaan(rotate=90))

    laius, korgus, _ = avaldatud[0]
    assert (laius, korgus) == (1000, 1600), "90° pööre vahetab laiuse ja kõrguse"


def test_poordeta_leht_jaab_samaks(apply_env):
    avaldatud = apply_env

    prepress_apply._transfer_pages(
        "u1", "x", ("/srv/st", "/srv/st/w"), "/srv/st/w", _plaan(rotate=0))

    assert avaldatud[0][:2] == (1600, 1000)


def test_poore_rakendub_ENNE_loikamist(apply_env):
    """Kogu disaini tuum: pärast pööret on laius 1000, seega pooleks lõigatud
    lehed on 500 laiad. Kui pööre tuleks pärast lõikamist, oleks 800."""
    avaldatud = apply_env

    prepress_apply._transfer_pages(
        "u1", "x", ("/srv/st", "/srv/st/w"), "/srv/st/w",
        _plaan(rotate=90, mode="default"))

    assert len(avaldatud) == 2
    assert avaldatud[0][0] == 500, "pööratud lehe pool = 1000 / 2"
    assert avaldatud[0][1] == 1600


def test_180_kraadi_ei_muuda_mootmeid(apply_env):
    avaldatud = apply_env

    prepress_apply._transfer_pages(
        "u1", "x", ("/srv/st", "/srv/st/w"), "/srv/st/w", _plaan(rotate=180))

    assert avaldatud[0][:2] == (1600, 1000)


# --- Baitkoopia keeld ---

def test_poordega_leht_ei_ole_enam_baitkoopia(tmp_path):
    """Pööratud pilt EI OLE identity-koopia — kiirtee peab keelduma."""
    from server.upload import page_source

    kaust = tmp_path / "source"
    kaust.mkdir()
    from PIL import Image
    Image.new("RGB", (800, 1000)).save(kaust / "lk1.jpg", "JPEG", quality=88)
    src = page_source.open_page_source(str(kaust))

    assert prepress_apply.can_copy_source_bytes(src, _plaan(rotate=0), 1, 800) is True
    assert prepress_apply.can_copy_source_bytes(src, _plaan(rotate=90), 1, 800) is False


# --- Eelvaate pööre: renderdusparameeter, mitte CSS ---
#
# Server annab juba pööratud pildi, seega kontaktlehe `imageWidthRatio` ja
# täisvaate `imgBox` matemaatika ei tea pöördest midagi. Just see geomeetria on
# varem kaks korda katki läinud (object-cover lõikas avause küljed; joon jooksis
# letterboxi) — pöörde lisamine sinna oleks kolmas kord.

def test_rotated_preview_path_annab_pooratud_pildi(tmp_path, monkeypatch):
    from server.upload import prepress
    from PIL import Image

    monkeypatch.setattr(prepress.upload_state, "UPLOADS_DIR", str(tmp_path))
    kaust = tmp_path / "u1" / "preview"
    kaust.mkdir(parents=True)
    Image.new("RGB", (700, 500)).save(kaust / "pg_0003.jpg", "JPEG", quality=80)

    tee = prepress.rotated_preview_path("u1", 3, 90)

    with Image.open(tee) as im:
        assert im.size == (500, 700)


def test_rotated_preview_path_vahemalustab(tmp_path, monkeypatch):
    from server.upload import prepress
    from PIL import Image

    monkeypatch.setattr(prepress.upload_state, "UPLOADS_DIR", str(tmp_path))
    kaust = tmp_path / "u1" / "preview"
    kaust.mkdir(parents=True)
    Image.new("RGB", (700, 500)).save(kaust / "pg_0003.jpg", "JPEG", quality=80)

    esimene = prepress.rotated_preview_path("u1", 3, 90)
    mtime = Path(esimene).stat().st_mtime_ns
    teine = prepress.rotated_preview_path("u1", 3, 90)

    assert esimene == teine
    assert Path(teine).stat().st_mtime_ns == mtime, "teist korda ei renderdata"


def test_rotated_preview_path_null_kraadi_annab_originaali(tmp_path, monkeypatch):
    from server.upload import prepress
    from PIL import Image

    monkeypatch.setattr(prepress.upload_state, "UPLOADS_DIR", str(tmp_path))
    kaust = tmp_path / "u1" / "preview"
    kaust.mkdir(parents=True)
    Image.new("RGB", (700, 500)).save(kaust / "pg_0003.jpg", "JPEG", quality=80)

    assert prepress.rotated_preview_path("u1", 3, 0) == prepress.preview_path("u1", 3)


# --- Plaani salvestus võtab pöörde vastu ---

def test_plaani_salvestus_hoiab_poorde(client, login, make_upload):
    from server.upload import state as st

    make_upload("upl900", status="awaiting_split", expected_pages=2)
    st.set_upload_state("upl900", prepress=prepress_plan.default_plan(2))

    token = login("admin", "adminpass")
    r = client.post(
        "/admin/upload/upl900/prepress",
        headers={"Authorization": "Bearer {}".format(token)},
        json={"default_split_x": 0.5, "pages": [
            {"n": 1, "mode": "nosplit", "split_x": None, "excluded": False, "rotate": 90},
            {"n": 2, "mode": "nosplit", "split_x": None, "excluded": False, "rotate": 0},
        ]},
    )

    assert r.status_code == 200
    plan = st.read_state("upl900")["prepress"]
    assert prepress_plan.rotate_of(plan, 1) == 90
    assert prepress_plan.rotate_of(plan, 2) == 0


def test_plaani_salvestus_lykkab_vigase_poorde_tagasi(client, login, make_upload):
    from server.upload import state as st

    make_upload("upl901", status="awaiting_split", expected_pages=1)
    st.set_upload_state("upl901", prepress=prepress_plan.default_plan(1))

    token = login("admin", "adminpass")
    r = client.post(
        "/admin/upload/upl901/prepress",
        headers={"Authorization": "Bearer {}".format(token)},
        json={"default_split_x": 0.5, "pages": [
            {"n": 1, "mode": "nosplit", "split_x": None, "excluded": False, "rotate": 45},
        ]},
    )

    assert r.status_code == 400
