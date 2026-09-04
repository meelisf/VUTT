"""Otsast lõpuni: import_as_work täidetud ADA-plokiga.

Task 1 leid (create_upload viskas ADA väljad ära) on otsene tõend, et
"käsitsi kontrollitud" ei ela üle ülesande-piiri. `leia_ankrud` ise on
hästi kaetud (test_ada_provenance.py) — see fail testib JUHTMESTUST:
et `ada_ankrud`-i võtmed (leia_ankrud tagastuskuju) klapivad
import_as_work'i `jrk`-loendajaga, et funktsioonisisene
`from ..ada import provenance as ada_provenance` import on ulatuses
seal, kus teda kasutatakse, ja et kommentaar jõuab TEGELIKULT kettale
kirjutatud lehe-JSON-i massiivi.

Mudel testile: tests/test_err_page_import.py.
"""
import json
from pathlib import Path

from server import upload_ops
from server.upload import state as upload_state


class _ImportSftp:
    """SFTP fake: kolm tervet lehte, iga jpg/txt paar valmis."""

    def __init__(self, items):
        self.items = items
        self.get_calls = []

    def listdir(self, _path):
        return self.items

    def get(self, remote, local):
        self.get_calls.append(remote)
        if remote.endswith(".jpg"):
            Path(local).write_bytes(b"jpg")
        elif remote.endswith(".txt"):
            if Path(remote).name not in self.items:
                raise FileNotFoundError(remote)
            Path(local).write_text("OCR tekst", encoding="utf-8")
        else:
            raise FileNotFoundError(remote)

    def close(self):
        pass


def test_import_as_work_kirjutab_ada_provenance_oigele_lehele(tmp_path, monkeypatch):
    """Kolm lähte-lehte, kõik säilivad muutumatult (identity page_map) —
    ADA tüki 'a.pdf' ankur peab olema esimene VÄLJUNDLEHT (jrk=1, out=1).
    Kontrollime, et:
      1. Ainult õige leht (lk 1) saab `source`-välja, teised mitte.
      2. `comments`-massiivis on TÄPSELT ADA kommentaar (autor 'ada-import').
      3. Kommentaari tekst kannab bitstream-faili nime ja handle'it.
    """
    import server.git_ops as git_ops
    import server.meilisearch_ops as meili_ops
    import server.prosopography.indices as prosopo_indices
    import server.prosopography.person_crud as person_crud

    uploads = tmp_path / "uploads"
    (uploads / "impada" / "thumbs").mkdir(parents=True)
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

    sftp = _ImportSftp([
        "ada-teos_pg_001.jpg", "ada-teos_pg_001.txt",
        "ada-teos_pg_002.jpg", "ada-teos_pg_002.txt",
        "ada-teos_pg_003.jpg", "ada-teos_pg_003.txt",
    ])
    monkeypatch.setattr(upload_ops, "_sftp_open", lambda uid: sftp)

    (uploads / "impada" / "state.json").write_text(json.dumps({
        "id": "impada", "status": "reviewing",
        "meta": {"title": "ADA teos", "year": "1812", "slug": "ada-teos", "work_id": "widada"},
        "remote_staging_path": "AUTO-OCR/print/impada",
        "remote_work_path": "AUTO-OCR/print/impada/ada-teos",
        "files": [
            {"page": 1, "has_ocr": True, "deleted": False},
            {"page": 2, "has_ocr": True, "deleted": False},
            {"page": 3, "has_ocr": True, "deleted": False},
        ],
        # Identity page_map: ei poolitust, ei väljajätmist — src N → out N.
        "prepress": {"page_map": {"1": [1], "2": [2], "3": [3]}},
        "ada": {
            "handle": "10062/7822",
            "item_uuid": "u1",
            "sources": [
                {"name": "a.pdf", "bitstream_uuid": "bs-a",
                 "first_src_page": 1, "page_count": 1},
                {"name": "b.pdf", "bitstream_uuid": "bs-b",
                 "first_src_page": 2, "page_count": 2},
            ],
        },
    }), encoding="utf-8")

    tulemus = upload_ops.import_as_work("impada", username="admin")
    assert tulemus["slug"] == "ada-teos"

    def _leht_json(n):
        path = next((data_dir / "ada-teos").glob(f"*-{n:03d}.json"))
        return json.loads(path.read_text(encoding="utf-8"))

    lk1 = _leht_json(1)
    assert lk1.get("source", {}).get("name") == "a.pdf"
    assert lk1.get("source", {}).get("bitstream_uuid") == "bs-a"
    assert len(lk1["comments"]) == 1
    assert lk1["comments"][0]["author"] == "ada-import"
    assert "a.pdf" in lk1["comments"][0]["text"]
    assert "10062/7822" in lk1["comments"][0]["text"]

    # b.pdf katab src-lehed 2..3; ankur on selle ESIMENE väljundleht (out=2) —
    # vt leia_ankrud (server/ada/provenance.py). Lk 3 jääb provenance'ita.
    lk2 = _leht_json(2)
    assert lk2.get("source", {}).get("name") == "b.pdf"
    assert len(lk2["comments"]) == 1
    assert lk2["comments"][0]["author"] == "ada-import"

    lk3 = _leht_json(3)
    assert "source" not in lk3
    assert lk3["comments"] == []


def test_import_as_work_ankur_jargib_jrk_mitte_lehekylje_numbrit(tmp_path, monkeypatch):
    """Väljundleht 1 on kustutatud (`deleted: True`) — importable jrk (1,2)
    ja tegelik lehekülje number (2,3) LAHKNEVAD. `ada_ankrud` on leia_ankrud'i
    tagastuskuju, mille võtmed on RANK säilinud lehtede seas, mitte
    lehekülje enda number — kui import_as_work eksikombel indekseeriks
    `ada_ankrud`-i `entry['page']`-ga (lehe numbriga), ei leiaks b.pdf enam
    oma ankrut ja provenance kaoks vaikselt (vt task 1 õppetund: seesama
    viga juba juhtus create_upload'i teisel kohal)."""
    import server.git_ops as git_ops
    import server.meilisearch_ops as meili_ops
    import server.prosopography.indices as prosopo_indices
    import server.prosopography.person_crud as person_crud

    uploads = tmp_path / "uploads"
    (uploads / "impgap" / "thumbs").mkdir(parents=True)
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

    # Ainult lehed 2 ja 3 on OCR-serveris (lk 1 kustutati ülevaatuses juba
    # varem ega jõudnudki siia sftp.listdir'i loendisse).
    sftp = _ImportSftp([
        "gap-teos_pg_002.jpg", "gap-teos_pg_002.txt",
        "gap-teos_pg_003.jpg", "gap-teos_pg_003.txt",
    ])
    monkeypatch.setattr(upload_ops, "_sftp_open", lambda uid: sftp)

    (uploads / "impgap" / "state.json").write_text(json.dumps({
        "id": "impgap", "status": "reviewing",
        "meta": {"title": "Lünkteos", "year": "1812", "slug": "gap-teos", "work_id": "widgap"},
        "remote_staging_path": "AUTO-OCR/print/impgap",
        "remote_work_path": "AUTO-OCR/print/impgap/gap-teos",
        "files": [
            {"page": 1, "has_ocr": True, "deleted": True},
            {"page": 2, "has_ocr": True, "deleted": False},
            {"page": 3, "has_ocr": True, "deleted": False},
        ],
        "prepress": {"page_map": {"1": [1], "2": [2], "3": [3]}},
        "ada": {
            "handle": "10062/7822",
            "item_uuid": "u1",
            "sources": [
                {"name": "a.pdf", "bitstream_uuid": "bs-a",
                 "first_src_page": 1, "page_count": 1},
                {"name": "b.pdf", "bitstream_uuid": "bs-b",
                 "first_src_page": 2, "page_count": 2},
            ],
        },
    }), encoding="utf-8")

    tulemus = upload_ops.import_as_work("impgap", username="admin")
    assert tulemus["slug"] == "gap-teos"

    json_files = sorted((data_dir / "gap-teos").glob("gap-teos-widgap-*.json"))
    assert len(json_files) == 2
    esimene = json.loads(json_files[0].read_text(encoding="utf-8"))
    teine = json.loads(json_files[1].read_text(encoding="utf-8"))
    # Importable esimene kirje on lehekülg 2 (jrk=1) — b.pdf ankur peab olema
    # SELLEL lehel, mitte kadunud, kuigi lehekülje number (2) ei ole 1.
    assert esimene.get("source", {}).get("name") == "b.pdf"
    assert "source" not in teine


def test_import_as_work_ilma_ada_plokita_ei_puuduta_provenance_i(tmp_path, monkeypatch):
    """Tavaline (mitte-ADA) upload — `ada` puudub state'is täielikult.
    `ada_provenance` import EI TOHI toimuda ja lehed jäävad provenance'ita
    (regressioon: task-11 kirjeldas seda kui EINSA kohta, mis vastutab
    selle eest, et tavaline üleslaadimine ei kanna ADA-välju kaasa)."""
    import server.git_ops as git_ops
    import server.meilisearch_ops as meili_ops
    import server.prosopography.indices as prosopo_indices
    import server.prosopography.person_crud as person_crud

    uploads = tmp_path / "uploads"
    (uploads / "imppla" / "thumbs").mkdir(parents=True)
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

    sftp = _ImportSftp(["plain-teos_pg_001.jpg", "plain-teos_pg_001.txt"])
    monkeypatch.setattr(upload_ops, "_sftp_open", lambda uid: sftp)

    (uploads / "imppla" / "state.json").write_text(json.dumps({
        "id": "imppla", "status": "reviewing",
        "meta": {"title": "Tavaline teos", "year": "1700", "slug": "plain-teos",
                 "work_id": "widplain"},
        "remote_staging_path": "AUTO-OCR/print/imppla",
        "remote_work_path": "AUTO-OCR/print/imppla/plain-teos",
        "files": [{"page": 1, "has_ocr": True, "deleted": False}],
    }), encoding="utf-8")

    tulemus = upload_ops.import_as_work("imppla", username="admin")
    assert tulemus["slug"] == "plain-teos"
    json_path = next((data_dir / "plain-teos").glob("*-001.json"))
    leht = json.loads(json_path.read_text(encoding="utf-8"))
    assert "source" not in leht
    assert leht["comments"] == []
