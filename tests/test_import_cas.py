"""Import on ühekordne ja tema staatus on nähtav (#327).

524-leheline teos importis 75 sekundiga. nginx-i vaikimisi
`proxy_read_timeout` on 60 s, seega klient sai 504, kuigi import läks
serveris lõpuni — kasutaja nägi veateadet valmis teose kohta.

Siin on selle juure kolm serveripoolset tagajärge:
  * import ei märkinud kuskil, et ta KÄIB (kordusklikk sai segase
    „Kaust ... on juba olemas" asemel 409-t),
  * poll oleks jooksva impordi staatuse üle kirjutanud (sama muster kui
    I1 `applying` juures, ADR 0028),
  * katkenud import peab staatuse TAGASI andma, muidu jääks upload
    igaveseks importimatuks.
"""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import upload_ops
from server.upload import import_work, state as upload_state, thumbs


class _Sftp:
    """SFTP fake: kaks tervet lehte. `enne_listdir` = konks impordi keskele."""

    def __init__(self, items, enne_listdir=None):
        self.items = items
        self.enne_listdir = enne_listdir

    def listdir(self, _path):
        if self.enne_listdir:
            self.enne_listdir()
        return self.items

    def get(self, remote, local):
        if remote.endswith(".jpg"):
            Path(local).write_bytes(b"jpg")
        else:
            Path(local).write_text("OCR tekst", encoding="utf-8")

    def close(self):
        pass


def _seadista(tmp_path, monkeypatch, sftp, *, staatus="reviewing"):
    import server.git_ops as git_ops
    import server.meilisearch_ops as meili_ops
    import server.prosopography.indices as prosopo_indices
    import server.prosopography.person_crud as person_crud

    uploads = tmp_path / "uploads"
    (uploads / "imp1" / "thumbs").mkdir(parents=True)
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    monkeypatch.setattr(upload_ops, "UPLOADS_DIR", str(uploads))
    monkeypatch.setattr(upload_state, "UPLOADS_DIR", str(uploads))
    monkeypatch.setattr(upload_ops, "BASE_DIR", str(data_dir))
    monkeypatch.setattr(git_ops, "commit_new_work_to_git", lambda *a, **kw: True)
    monkeypatch.setattr(meili_ops, "sync_work_to_meilisearch", lambda slug: True)
    monkeypatch.setattr(person_crud, "ensure_prosopo_stubs", lambda metadata, username=None: {})
    monkeypatch.setattr(prosopo_indices, "update_person_to_works", lambda *a, **kw: None)
    monkeypatch.setattr(prosopo_indices, "update_work_collections", lambda *a, **kw: None)
    monkeypatch.setattr(upload_ops, "_ssh_rm_rf", lambda *a, **kw: None)
    monkeypatch.setattr(upload_ops, "close_ssh", lambda *a, **kw: None)
    monkeypatch.setattr(upload_ops, "_sftp_open", lambda uid: sftp)

    (uploads / "imp1" / "state.json").write_text(json.dumps({
        "id": "imp1", "status": staatus,
        "meta": {"title": "Test teos", "year": "1700", "slug": "test-teos",
                 "work_id": "wid123"},
        "remote_staging_path": "AUTO-OCR/print/imp1",
        "remote_work_path": "AUTO-OCR/print/imp1/test-teos",
        "files": [{"page": 1, "has_ocr": True, "deleted": False},
                  {"page": 2, "has_ocr": True, "deleted": False}],
    }), encoding="utf-8")
    return data_dir


def _staatus():
    return upload_state.read_state("imp1")["status"]


def test_jooksva_impordi_ajal_on_staatus_importing_ja_teine_kutse_kukub(tmp_path, monkeypatch):
    """Kordusklikk 504 peale ei tohi teist importi alustada.

    Konks jookseb impordi SEES (esimene SFTP-päring), seega mõõdame olekut
    täpselt sel hetkel, mil kasutaja teist korda vajutab.
    """
    nahtud = {}

    def konks():
        # Erandit EI visata siit: konks jookseb `except Exception` sees ja
        # kinnitus kaoks vaikselt veateate sisse (vt vaakum-mock reegel).
        nahtud["staatus"] = _staatus()
        try:
            upload_ops.import_as_work("imp1", username="admin")
            nahtud["teine_kutse"] = "õnnestus"
        except ValueError as e:
            nahtud["teine_kutse"] = str(e)

    sftp = _Sftp(["test-teos_pg_001.jpg", "test-teos_pg_001.txt",
                  "test-teos_pg_002.jpg", "test-teos_pg_002.txt"],
                 enne_listdir=konks)
    _seadista(tmp_path, monkeypatch, sftp)

    upload_ops.import_as_work("imp1", username="admin")

    assert nahtud["staatus"] == "importing", "import ei märgi, et ta käib"
    assert "juba käib" in nahtud.get("teine_kutse", ""), (
        "teine import ei saanud selget „juba käib\" vastust: {!r}".format(
            nahtud.get("teine_kutse")))
    assert _staatus() == "imported"


def test_katkenud_import_annab_staatuse_tagasi(tmp_path, monkeypatch):
    """Ilma taasteta jääks upload igaveseks `importing`-usse ja importimatuks."""
    sftp = _Sftp(["test-teos_pg_001.jpg"])  # lk 2 puudub → preflight kukub
    _seadista(tmp_path, monkeypatch, sftp)

    with pytest.raises(ValueError):
        upload_ops.import_as_work("imp1", username="admin")

    assert _staatus() == "reviewing"


def test_poll_ei_puutu_jooksva_impordi_staatust(tmp_path, monkeypatch):
    """Sama valvur nagu I1 `applying` juures: elutsükli-staatust omab importija.

    Ilma selleta kirjutaks viisardi 5-sekundiline poll `importing` kohe
    `done`-iks tagasi ja järgmine klikk alustaks teise impordi.
    """
    sftp = _Sftp([])
    _seadista(tmp_path, monkeypatch, sftp, staatus="importing")

    avatud = []

    def _margi_avamine(_uid):
        # Lipp, mitte erand: `poll_and_sync_thumbs` mähib kogu töö laia
        # `except Exception`-i sisse ja kinnitus kaoks veateate sisse.
        avatud.append(_uid)
        return _Sftp([])

    vastus = thumbs.poll_and_sync_thumbs("imp1", sftp_open_func=_margi_avamine)

    assert not avatud, "poll avas impordi ajal SFTP ühenduse"
    assert vastus["status"] == "importing"
    assert _staatus() == "importing"


def test_rippuv_importing_taastatakse_kaivitusel(tmp_path, monkeypatch):
    """Konteineri restart impordi ajal tapab lõime enne except-haru (#256 muster)."""
    sftp = _Sftp([])
    _seadista(tmp_path, monkeypatch, sftp, staatus="importing")
    s = upload_state.read_state("imp1")
    s["import_prev_status"] = "done"
    upload_state.write_state("imp1", s)

    import_work.taasta_rippuvad_impordid()

    assert _staatus() == "done"
    assert "import_prev_status" not in upload_state.read_state("imp1")


def test_import_kirjutab_edenemise_faasid(tmp_path, monkeypatch):
    """Kasutaja peab nägema, MIS toimub — impordi ajal ekraan muidu ei liigu.

    Faasid tulevad järjekorras ja allalaadimise loendur jõuab lõpuni; lõpus
    märki enam ei ole (`imported` on lõppseisund, mitte edenemine).
    """
    nahtud = []
    paris_write = upload_state.write_state

    def _jalgi(uid, s):
        p = s.get("import_progress")
        if p:
            nahtud.append((p["phase"], p["done"], p["total"]))
        paris_write(uid, s)

    sftp = _Sftp(["test-teos_pg_001.jpg", "test-teos_pg_001.txt",
                  "test-teos_pg_002.jpg", "test-teos_pg_002.txt"])
    _seadista(tmp_path, monkeypatch, sftp)
    monkeypatch.setattr(upload_ops, "_write_state", _jalgi)

    upload_ops.import_as_work("imp1", username="admin")

    faasid = [f for f, _, _ in nahtud]
    assert faasid[0] == "downloading"
    assert faasid.index("git") < faasid.index("meili"), "faasid vales järjekorras"
    assert ("downloading", 2, 2) in nahtud, "loendur ei jõudnud viimase leheni"
    assert "import_progress" not in upload_state.read_state("imp1")


def test_poll_annab_edenemise_kliendile(tmp_path, monkeypatch):
    """Edenemine peab jõudma staatusevastusesse — poll on ainus tee kasutajani."""
    sftp = _Sftp([])
    _seadista(tmp_path, monkeypatch, sftp, staatus="importing")
    s = upload_state.read_state("imp1")
    s["import_progress"] = {"phase": "downloading", "done": 7, "total": 12}
    upload_state.write_state("imp1", s)

    vastus = thumbs.poll_and_sync_thumbs("imp1", sftp_open_func=lambda _u: _Sftp([]))

    assert vastus["import_progress"] == {"phase": "downloading", "done": 7, "total": 12}
