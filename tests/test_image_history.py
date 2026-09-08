"""Muudetud piltide loend ja `transform_image.log` leping (#325).

Logireal on angle/crop/quad ALATI kohal, ka väärtustega 0.0 ja None — tegevus
tuleb tuletada VÄÄRTUSEST, mitte võtme olemasolust. Üks salvestus võib
sisaldada mitut teisendust. `split_page` ei kirjuta siia ridagi — aga rea puudumine EI TÕESTA poolitust
(logi võib puududa või olla katki), seega logita kirje jääb neutraalseks.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import image_history


KARBE = ("2026-09-07T12:54:49.150562 | raheltoomik | 9ghbrc | lk_003.jpg | "
         "angle=0.0 crop={'x': 0.49, 'y': 0.01, 'w': 0.5, 'h': 0.97} quad=None | -> 2349x3239")
PUUTUMATA = ("2026-09-04T10:00:00.000000 | meelis | 9ghbrc | lk_004.jpg | "
             "angle=0.0 crop=None quad=None | -> 100x100")
POORE_JA_KARBE = ("2026-09-04T11:00:00.000000 | meelis | 9ghbrc | lk_005.jpg | "
                  "angle=1.5 crop={'x': 0} quad=None | -> 100x100")
TAASTUS = "2026-09-05T09:00:00.000000 | meelis | 9ghbrc | lk_003.jpg | restore_original | -> restored"


def test_karbe_tuvastatakse_vaartusest():
    kirje = image_history.parsi_logirida(KARBE)
    assert kirje["action"] == ["crop"]
    assert kirje["by"] == "raheltoomik"
    assert kirje["filename"] == "lk_003.jpg"


def test_nullvaartused_ei_ole_tegevused():
    """`angle=0.0 crop=None quad=None` = midagi ei tehtud."""
    assert image_history.parsi_logirida(PUUTUMATA)["action"] == []


def test_uks_toiming_mitu_tegevust():
    assert image_history.parsi_logirida(POORE_JA_KARBE)["action"] == ["rotate", "crop"]


def test_taastuse_rida():
    assert image_history.parsi_logirida(TAASTUS)["action"] == ["restore"]


def test_katkine_rida_ei_kuku():
    assert image_history.parsi_logirida("prügi ilma torudeta") is None
    assert image_history.parsi_logirida("") is None


def test_puuduv_logi_ei_kuku_ja_jatab_koik_neutraalseks(tmp_path, monkeypatch):
    """Logifaili ei ole → kirjed on ikka nähtaval, ilma vale sildita.

    Just siin läheks „logireata = poolitusest" valeks: kärbitud ja pööratud
    lehed saaksid kõik sildi „poolitusest".
    """
    data = tmp_path
    töö = data / "1701-w2"
    töö.mkdir()
    (töö / "a.jpg").write_bytes(b"\xff\xd8jpg")
    originals = data / "._originals" / "w2"
    originals.mkdir(parents=True)
    (originals / "a.jpg").write_bytes(b"\xff\xd8jpg")
    # transform_image.log PUUDUB

    monkeypatch.setattr(image_history, "BASE_DIR", str(data))
    monkeypatch.setattr(image_history, "find_directory_by_id", lambda wid: str(töö))

    kirjed = image_history.muudetud_pildid("w2")

    assert len(kirjed) == 1
    assert kirjed[0]["action"] == []
    assert kirjed[0]["at"] is None and kirjed[0]["by"] is None


def test_muudetud_pildid_filtreerib_ja_jaab_logita_neutraalseks(tmp_path, monkeypatch):
    """Kolm asja korraga: kadunud fail välja, logita kirje neutraalne,
    lehekülje number tuleb teose kausta järjekorrast."""
    data = tmp_path
    töö = data / "1700-w1"
    töö.mkdir()
    for nimi in ("a.jpg", "b.jpg"):
        (töö / nimi).write_bytes(b"\xff\xd8jpg")
    originals = data / "._originals" / "w1"
    originals.mkdir(parents=True)
    for nimi in ("a.jpg", "b.jpg", "kadunud.jpg"):
        (originals / nimi).write_bytes(b"\xff\xd8jpg")
    (data / "transform_image.log").write_text(
        "2026-09-07T12:00:00.000000 | meelis | w1 | a.jpg | "
        "angle=0.0 crop={'x': 0.1} quad=None | -> 10x10\n",
        encoding="utf-8")

    monkeypatch.setattr(image_history, "BASE_DIR", str(data))
    monkeypatch.setattr(image_history, "find_directory_by_id", lambda wid: str(töö))

    kirjed = {k["filename"]: k for k in image_history.muudetud_pildid("w1")}

    assert set(kirjed) == {"a.jpg", "b.jpg"}, "kadunud fail ei tohi loendis olla"
    assert kirjed["a.jpg"]["action"] == ["crop"] and kirjed["a.jpg"]["by"] == "meelis"
    assert kirjed["a.jpg"]["page"] == 1 and kirjed["b.jpg"]["page"] == 2
    # Logireata kirje jääb NEUTRAALSEKS. „Poolitusest" vajaks positiivset tõendit;
    # puuduv või katkine logi märgistaks muidu ka kärbitud lehed valesti.
    assert kirjed["b.jpg"]["action"] == []
    assert kirjed["b.jpg"]["by"] is None and kirjed["b.jpg"]["at"] is None
    assert kirjed["b.jpg"]["v"] > 0 and kirjed["b.jpg"]["v_current"] > 0
