"""Muudetud piltide loend ja `transform_image.log` leping (#325).

Logireal on angle/crop/quad ALATI kohal, ka väärtustega 0.0 ja None — tegevus
tuleb tuletada VÄÄRTUSEST, mitte võtme olemasolust. Üks salvestus võib
sisaldada mitut teisendust. `split_page` ei kirjuta siia ridagi — aga rea puudumine EI TÕESTA poolitust
(logi võib puududa või olla katki), seega logita kirje jääb neutraalseks.
"""
import sys
from pathlib import Path

from git import Repo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import image_history
import server.git_ops as git_ops


def _git_repo(juur: Path) -> Repo:
    """Ajutine git-repo BASE_DIR asukohas — sama muster nagu test_trash_ops.py
    `trash_repo` fixtuuris."""
    repo = Repo.init(str(juur))
    with repo.config_writer() as cw:
        cw.set_value("user", "name", "test").set_value("user", "email", "t@t")
    return repo


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
    # Tühi git-repo (ilma commitideta) — mitte päris projekti repo, mida
    # monkeypatchimata get_or_init_repo() muidu `config.py` BASE_DIR-i kaudu
    # avaks.
    monkeypatch.setattr(git_ops, "get_or_init_repo", lambda: _git_repo(data))

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
    monkeypatch.setattr(git_ops, "get_or_init_repo", lambda: _git_repo(data))

    kirjed = {k["filename"]: k for k in image_history.muudetud_pildid("w1")}

    assert set(kirjed) == {"a.jpg", "b.jpg"}, "kadunud fail ei tohi loendis olla"
    assert kirjed["a.jpg"]["action"] == ["crop"] and kirjed["a.jpg"]["by"] == "meelis"
    assert kirjed["a.jpg"]["page"] == 1 and kirjed["b.jpg"]["page"] == 2
    # Logireata kirje jääb NEUTRAALSEKS. „Poolitusest" vajaks positiivset tõendit;
    # puuduv või katkine logi märgistaks muidu ka kärbitud lehed valesti.
    assert kirjed["b.jpg"]["action"] == []
    assert kirjed["b.jpg"]["by"] is None and kirjed["b.jpg"]["at"] is None
    assert kirjed["b.jpg"]["v"] > 0 and kirjed["b.jpg"]["v_current"] > 0


# =========================================================
# Poolituse jäägid — positiivne tõend gitist (review, #325)
# =========================================================

def test_poolituse_pooled_ei_kuulu_muudetud_piltide_hulka(tmp_path, monkeypatch):
    """Mõlemal poolel on `._originals` kirje, aga LISAMISE commit algab
    poolituse prefiksiga → mõlemad jäävad "Muudetud pildid" loendist välja,
    isegi kui transform_image.log'is pole nende kohta ridagi."""
    data = tmp_path
    repo = _git_repo(data)
    folder = "1700-w1"
    töö = data / folder
    töö.mkdir()
    (töö / "a.jpg").write_bytes(b"\xff\xd8jpg")
    (töö / "b.jpg").write_bytes(b"\xff\xd8jpg")
    (töö / "a.txt").write_text("vasak", encoding="utf-8")
    (töö / "b.txt").write_text("parem", encoding="utf-8")
    repo.index.add([f"{folder}/a.txt", f"{folder}/b.txt"])
    repo.index.commit(f"Lõika leht 1 ({folder}): vasakpoolne [w1]")

    originals = data / "._originals" / "w1"
    originals.mkdir(parents=True)
    (originals / "a.jpg").write_bytes(b"\xff\xd8jpg")
    (originals / "b.jpg").write_bytes(b"\xff\xd8jpg")

    monkeypatch.setattr(image_history, "BASE_DIR", str(data))
    monkeypatch.setattr(image_history, "find_directory_by_id", lambda wid: str(töö))
    monkeypatch.setattr(git_ops, "get_or_init_repo", lambda: repo)

    assert image_history.muudetud_pildid("w1") == []


def test_tavaline_lisamine_ilma_logireata_jaab_muudetuks(tmp_path, monkeypatch):
    """LISAMISE commit ei kanna poolituse prefiksit (nt tavaline lisamine
    või ümberjärjestus) → kirje jääb NEUTRAALSEKS ja on loendis, action=[].
    „Poolitusest" vajab positiivset tõendit — selle puudumine ei tõesta midagi."""
    data = tmp_path
    repo = _git_repo(data)
    folder = "1700-w2"
    töö = data / folder
    töö.mkdir()
    (töö / "c.jpg").write_bytes(b"\xff\xd8jpg")
    (töö / "c.txt").write_text("sisu", encoding="utf-8")
    repo.index.add([f"{folder}/c.txt"])
    repo.index.commit(f"Lisa leht: {folder} [w2]")

    originals = data / "._originals" / "w2"
    originals.mkdir(parents=True)
    (originals / "c.jpg").write_bytes(b"\xff\xd8jpg")

    monkeypatch.setattr(image_history, "BASE_DIR", str(data))
    monkeypatch.setattr(image_history, "find_directory_by_id", lambda wid: str(töö))
    monkeypatch.setattr(git_ops, "get_or_init_repo", lambda: repo)

    kirjed = image_history.muudetud_pildid("w2")

    assert len(kirjed) == 1
    assert kirjed[0]["filename"] == "c.jpg"
    assert kirjed[0]["action"] == []


def test_git_viga_ei_kuku_ja_naitab_koiki_kirjeid(tmp_path, monkeypatch):
    """Git-otsingu ebaõnnestumine ei tohi paneeli kukutada — langeb tühja
    hulga peale, kirjed jäävad kõik nähtavale (neutraalne, mitte kadumine)."""
    data = tmp_path
    töö = data / "1700-w3"
    töö.mkdir()
    (töö / "d.jpg").write_bytes(b"\xff\xd8jpg")
    originals = data / "._originals" / "w3"
    originals.mkdir(parents=True)
    (originals / "d.jpg").write_bytes(b"\xff\xd8jpg")

    def _katkine_repo():
        raise RuntimeError("git repo pole kättesaadav")

    monkeypatch.setattr(image_history, "BASE_DIR", str(data))
    monkeypatch.setattr(image_history, "find_directory_by_id", lambda wid: str(töö))
    monkeypatch.setattr(git_ops, "get_or_init_repo", _katkine_repo)

    kirjed = image_history.muudetud_pildid("w3")

    assert len(kirjed) == 1
    assert kirjed[0]["filename"] == "d.jpg"
