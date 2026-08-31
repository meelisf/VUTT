# Üks tee: VUTT materialiseerib OCR-i lehed — teostusplaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Iga upload läbib ühe tee — VUTT materialiseerib OCR-i lehed (rasteriseerib PDF-i lehthaaval või kopeerib pildikausta baidid) ja avaldab iga lehe kohe; LOSS ainult OCR-ib. Ülevaatuse ekraan täitub apply ajal.

**Architecture:** `routers/upload.py:admin_prepress_apply` kaotab haru — kõik plaanid lähevad `prepress_apply.start_apply` kaudu. `prepress_apply._transfer_pages` kirjutab iga avaldatud lehe kohta ka lokaalse pisipildi, seega ülevaatus ei vaja apply ajal ühtki SFTP-allalaadimist. `poll_and_sync_thumbs` hakkab `applying` ajal jooksma, aga ainult lugejana: elutsükli-staatust omab apply-lõim.

**Tech Stack:** Python 3.9 (`Optional[dict]`, mitte `dict | None`), FastAPI, paramiko SFTP, Pillow, poppler (`pdftoppm`); frontend React 19 + TypeScript.

**Spec:** `docs/superpowers/specs/2026-08-31-uks-tee-vutt-renderdab-design.md`

## Global Constraints

- **Python 3.9 ühilduvus:** `Optional[dict]`, mitte `dict | None`.
- **Koodikommentaarid eesti keeles.**
- **Blokeeriv I/O `async def` sees on keelatud** (ADR 0002) — sync `def` route või `run_in_threadpool`.
- **Testid:** `.venv/bin/pytest tests/` (projekti venv, mitte süsteemi `python3`).
- **Frontendi väravad:** `npm run typecheck` (Vite EI typecheck'i), `npm test`, `npm run lint:ci` (lävi `--max-warnings 55`).
- **i18n:** uus võti tuleb lisada **mõlemasse keelde korraga** (`src/locales/et/` ja `src/locales/en/`) — `fallbackLng` on väljas, muidu katkeb build.
- **Kaugkoristus:** kunagi `rm -rf` lennusoleva batchi alt — ainult `ocr_client.cleanup_run_files` (ADR 0024, #225).
- **Invariandid spec'ist**, mis peavad koodis kommentaarina kirjas olema:
  - **I1:** kuni staatus on `applying`, ei muuda `poll_and_sync_thumbs` upload'i põhistaatust.
  - **I2:** `applying` ajal ei laadi poll ühtki kaug-JPG-d alla.
  - **I3:** apply ja poll ei jaga sama `SFTPClient`-i (juba täidetud; reegel dokumenteerida).
  - **`expected_pages`:** `awaiting_split`/`prepping` → lähte-lehtede arv; `applying`-ust alates → väljund-lehtede arv.

## File Structure

| Fail | Vastutus | Muutus |
|---|---|---|
| `server/upload/state.py` | upload'i olek, lukud, staatuse-konstandid | `PREPRESS_IDLE_STATUSES` kaotab `applying`; `try_begin_applying` seab `expected_pages` |
| `server/upload/thumbs.py` | poll + pisipiltide sünk | I1/I2 valvurid; uus avalik `write_thumbnail` |
| `server/upload/prepress_apply.py` | 300 DPI läbikäik, avaldamine | kirjutab pisipildi; baithaaval kopeerimine; retry-koristus |
| `server/upload/page_source.py` | lehepikslite allikas | uus `source_file(n)` `ImageDirPageSource`-ile |
| `server/upload/prepress_plan.py` | plaani puhas loogika | uus `can_copy_source_bytes` abifunktsioon ei lähe siia (vt Task 4) |
| `server/routers/upload.py` | HTTP-otspunktid | apply kaotab haru |
| `server/upload/store_source.py` | lähtefaili salvestus | edastusfunktsioonid pensionile |
| `server/upload/pdf_subset.py` | PDF-alamhulk | **kustub** |
| `server/config.py` | seaded, stardikontrollid | `WEB_CONCURRENCY` hoiatus |
| `src/pages/upload/useUploadWizard.ts` | viisardi olek | `ocrStartedAt` → `processingStartedAt` |
| `src/pages/upload/utils.ts` | tuletatud kuvaolek | sama ümbernimetamine |
| `src/pages/upload/components/UploadStepReview.tsx` | 4. sammu vaade | apply-faasi teade |
| `docs/decisions/0028-*.md` | ADR | **uus** |

---

### Task 1: Poll töötab apply ajal — I1, I2 ja `expected_pages` ühe tähendusega

Need kolm käivad koos: `applying` eemaldamine `PREPRESS_IDLE_STATUSES`-ist aktiveerib polli apply ajal, mis ilma I1/I2 valvuriteta rikub oleku ära, ja ilma `expected_pages` paranduseta arvutaks `_planned_pages` poolitused kaks korda.

**Files:**
- Modify: `server/upload/state.py:154` (`PREPRESS_IDLE_STATUSES`), `server/upload/state.py:207-226` (`try_begin_applying`)
- Modify: `server/upload/thumbs.py:117-121` (varajane väljumine), `~172-190` (allalaadimise silmus), `~215-225` (staatuse arvutus)
- Test: `tests/test_upload_apply_poll.py` (uus)

**Interfaces:**
- Consumes: `prepress_plan.output_page_count(plan, page_count) -> int` (olemas)
- Produces: `state.PREPRESS_IDLE_STATUSES == ("awaiting_split", "prepping")`; `try_begin_applying` kõrvalmõjuna `expected_pages = väljundlehtede arv`

- [ ] **Step 1: Kirjuta kukkuvad testid**

Loo `tests/test_upload_apply_poll.py`:

```python
"""Apply ajal on poll LUGEJA, mitte kirjutaja.

Kolm invarianti (spec 2026-08-31):
  I1 — kuni staatus on `applying`, ei muuda poll upload'i põhistaatust.
  I2 — `applying` ajal ei laadi poll ühtki kaug-JPG-d alla.
  expected_pages — `applying`-ust alates on see VÄLJUND-lehtede arv.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server.upload import state as upload_state, thumbs as upload_thumbs


class _SFTP:
    def __init__(self, tree):
        self.tree = tree
        self.gets = []

    def listdir(self, path):
        if path not in self.tree:
            raise FileNotFoundError(path)
        return list(self.tree[path])

    def stat(self, path):
        raise FileNotFoundError(path)

    def get(self, remote, local):
        self.gets.append(remote)

    def getfo(self, path, buf):
        buf.write(b"x")

    def close(self):
        pass


@pytest.fixture
def upload(tmp_path, monkeypatch):
    def _make(**yle):
        (tmp_path / "uploads" / "u1" / "thumbs").mkdir(parents=True, exist_ok=True)
        monkeypatch.setattr(
            upload_thumbs.upload_state, "UPLOADS_DIR", str(tmp_path / "uploads")
        )
        s = {
            "id": "u1", "status": "applying", "expected_pages": 2,
            "meta": {"slug": "1651-teos"},
            "remote_staging_path": "AUTO-OCR/hand/u1",
            "remote_work_path": "AUTO-OCR/hand/u1/1651-teos",
            "files": [],
        }
        s.update(yle)
        upload_state.write_state("u1", s)
        return "u1"
    return _make


WORK = "/srv/AUTO-OCR/hand/u1/1651-teos"
KOIK_VALMIS = {WORK: [
    "1651-teos_pg_001.jpg", "1651-teos_pg_001.txt",
    "1651-teos_pg_002.jpg", "1651-teos_pg_002.txt",
]}


def test_i1_applying_ajal_poll_ei_muuda_staatust(upload):
    """Sisendvoog ei ole veel suletud — `done`/`reviewing` kuulub apply-lõimele.

    Ilma selleta kirjutaks ESIMENE poll, mis mõnda JPG-d näeb, staatuse
    `reviewing`-uks keset apply't (`elif all_page_nums`).
    """
    uid = upload(status="applying", expected_pages=2)
    sftp = _SFTP(KOIK_VALMIS)

    res = upload_thumbs.poll_and_sync_thumbs(
        uid, ocr_server_path="/srv", sftp_open_func=lambda i: sftp)

    assert res["status"] == "applying"
    assert upload_state.read_state(uid)["status"] == "applying"


def test_i1_poll_annab_ikkagi_edenemise(upload):
    """Staatust ei muudeta, aga `ready`/`files` peavad kohale jõudma."""
    uid = upload(status="applying", expected_pages=2)
    sftp = _SFTP(KOIK_VALMIS)

    res = upload_thumbs.poll_and_sync_thumbs(
        uid, ocr_server_path="/srv", sftp_open_func=lambda i: sftp)

    assert res["ready"] == 2
    assert len(res["files"]) == 2


def test_i2_applying_ajal_ei_laadita_ainsatki_jpg_d(upload):
    """VUTT ei tõmba tagasi pilte, mille ta ise just saatis.

    Pisipilti lokaalselt EI OLE (fixture jätab thumbs/ tühjaks) — täpselt see
    aken, mis tekib publish_atomic ja write_thumbnail vahel.
    """
    uid = upload(status="applying", expected_pages=2)
    sftp = _SFTP(KOIK_VALMIS)

    upload_thumbs.poll_and_sync_thumbs(
        uid, ocr_server_path="/srv", sftp_open_func=lambda i: sftp)

    assert sftp.gets == [], "applying ajal ei tohi ühtki JPG-d alla laadida"


def test_processing_ajal_laaditakse_ja_staatus_liigub(upload):
    """`processing`-ust alates on poll jälle täisõiguslik."""
    uid = upload(status="processing", expected_pages=2)
    sftp = _SFTP(KOIK_VALMIS)
    loodud = []
    monkey = getattr(upload_thumbs, "_create_thumbnail")
    upload_thumbs._create_thumbnail = lambda s, r, tmp, dst: loodud.append(r)
    try:
        res = upload_thumbs.poll_and_sync_thumbs(
            uid, ocr_server_path="/srv", sftp_open_func=lambda i: sftp)
    finally:
        upload_thumbs._create_thumbnail = monkey

    assert len(loodud) == 2
    assert res["status"] == "done"


def test_try_begin_applying_seab_valjundlehtede_arvu(tmp_path, monkeypatch):
    """`expected_pages` saab apply alguses ÜHE tähenduse — väljundi arv.

    Ilma selleta peaks `_planned_pages` staatuse järgi arvama, kumb tähendus
    kehtib, ja `applying` eemaldamine PREPRESS_IDLE_STATUSES-ist loeks
    poolitused kaks korda (mõõdetud tootmises: 62 → 89).
    """
    monkeypatch.setattr(upload_state, "UPLOADS_DIR", str(tmp_path / "uploads"))
    (tmp_path / "uploads" / "u2").mkdir(parents=True)
    upload_state.write_state("u2", {
        "id": "u2", "status": "awaiting_split", "expected_pages": 3,
        "meta": {"slug": "x"},
        "prepress": {"pages": [
            {"n": 1, "mode": "default", "split_x": None, "excluded": False},
            {"n": 2, "mode": "default", "split_x": None, "excluded": False},
            {"n": 3, "mode": "nosplit", "split_x": None, "excluded": False},
        ], "default_split_x": 0.5},
    })

    assert upload_state.try_begin_applying("u2") is True

    s = upload_state.read_state("u2")
    assert s["status"] == "applying"
    assert s["expected_pages"] == 5, "2 poolitatavat → 4, + 1 nosplit = 5"


def test_planned_pages_applying_ajal_ei_topeltloe(upload):
    """`expected_pages` on nüüd juba väljundi arv — plaani ei tohi uuesti rakendada."""
    uid = upload(status="applying", expected_pages=5, prepress={"pages": [
        {"n": 1, "mode": "default", "split_x": None, "excluded": False},
        {"n": 2, "mode": "default", "split_x": None, "excluded": False},
        {"n": 3, "mode": "nosplit", "split_x": None, "excluded": False},
    ], "default_split_x": 0.5})
    sftp = _SFTP({WORK: []})

    res = upload_thumbs.poll_and_sync_thumbs(
        uid, ocr_server_path="/srv", sftp_open_func=lambda i: sftp)

    assert res["planned_pages"] == 5
```

- [ ] **Step 2: Jooksuta testid ja veendu, et nad kukuvad**

Run: `.venv/bin/pytest tests/test_upload_apply_poll.py -v`
Expected: FAIL — `test_i1_*` ja `test_i2_*` kukuvad, sest poll väljub `applying` ajal varakult (`res["ready"] == 0`); `test_try_begin_applying_seab_valjundlehtede_arvu` kukub `assert s["expected_pages"] == 5` peal (jääb 3).

- [ ] **Step 3: `PREPRESS_IDLE_STATUSES` kaotab `applying`**

`server/upload/state.py:152-154` asenda:

```python
# Staatused, mille korral OCR-serveri SFTP-pollimist ei ole vaja: fail on
# VUTT-i poolel ja OCR pole veel alanud.
#
# `applying` EI KUULU siia (spec 2026-08-31): apply avaldab lehti lehthaaval ja
# LOSS alustab OCR-i kohe, seega apply ajal ON kaugkataloogis vaadata. Poll on
# siis LUGEJA — vt I1/I2 valvureid thumbs.py-s.
#
# Sama konstant vastab ka küsimusele „kas `expected_pages` on veel LÄHTE-lehtede
# arv" (`thumbs._planned_pages`). Need kaks tähendust langesid kokku alles siis,
# kui `try_begin_applying` hakkas apply alguses väljundi arvu seadma.
PREPRESS_IDLE_STATUSES = ("awaiting_split", "prepping")
```

- [ ] **Step 4: `try_begin_applying` seab väljundlehtede arvu**

`server/upload/state.py`, `try_begin_applying` kehas, `s["status"] = "applying"` järele:

```python
        s["status"] = "applying"
        # `expected_pages` saab siin ÜHE tähenduse: alates `applying`-ust on see
        # VÄLJUND-lehtede arv. Ilma selleta peaks iga lugeja staatuse järgi
        # arvama, kumba arvu väli parasjagu kannab.
        from . import prepress_plan
        plan = s.get("prepress")
        allikalehti = s.get("expected_pages")
        if plan and allikalehti:
            try:
                s["expected_pages"] = prepress_plan.output_page_count(
                    plan, int(allikalehti))
            except Exception as e:
                logger.warning(
                    "expected_pages arvutus ebaõnnestus {}: {}".format(upload_id, e))
```

- [ ] **Step 5: I1 ja I2 valvurid `thumbs.py`-s**

`server/upload/thumbs.py`, pärast `current_status` lugemist lisa:

```python
    # Apply ajal on poll LUGEJA (spec 2026-08-31):
    #   I1 — elutsükli-staatust omab apply-lõim; poll ei tohi seda muuta.
    #   I2 — VUTT ei tõmba tagasi pilte, mille ta ise just saatis.
    on_applying = current_status == "applying"
```

Allalaadimise silmus (`for base in sorted(jpg_bases):`) pane I2 taha:

```python
        # I2: `applying` ajal kirjutab pisipildid prepress_apply lokaalselt.
        # publish_atomic ja write_thumbnail vahel on aken, kus kaug-JPG on
        # olemas ja lokaalne pisipilt mitte — ilma selle valvurita tõmbaks poll
        # selles aknas pildi võrgu kaudu tagasi.
        if not on_applying:
            for base in sorted(jpg_bases):
                ...  # senine keha muutmata
```

Staatuse arvutus:

```python
        # --- Uus staatus ---
        ready_count = len(ready_page_nums)
        resolved_count = ready_count + len(failed_page_nums)
        new_status = current_status
        # I1: `applying` ajal ei ole sisendvoog veel suletud. Ilma selleta
        # kirjutaks juba esimene JPG-d näinud poll staatuse `reviewing`-uks ja
        # apply-lõimu lõpetav `processing` tuleks alles pärast seda.
        if not on_applying:
            if expected_pages and resolved_count >= expected_pages:
                new_status = "done"
            elif all_page_nums:
                new_status = "reviewing"
```

- [ ] **Step 6: Jooksuta testid**

Run: `.venv/bin/pytest tests/test_upload_apply_poll.py tests/test_upload_placeholders.py -v`
Expected: PASS (kõik)

- [ ] **Step 7: Jooksuta kogu backend-komplekt**

Run: `.venv/bin/pytest tests/ -q`
Expected: PASS. Kui `tests/test_upload_background_sync.py` või `test_backend_smoke.py` eeldab `applying` kuulumist `PREPRESS_IDLE_STATUSES`-i, paranda test ootust — mitte konstanti.

- [ ] **Step 8: Commit**

```bash
git add server/upload/state.py server/upload/thumbs.py tests/test_upload_apply_poll.py
git commit -m "feat(upload): poll töötab apply ajal lugejana (I1, I2); expected_pages saab ühe tähenduse"
```

---

### Task 2: `write_thumbnail` — atomaarne ja jagatud

**Files:**
- Modify: `server/upload/thumbs.py:28-36` (`_create_thumbnail`)
- Test: `tests/test_upload_thumbnail_write.py` (uus)

**Interfaces:**
- Produces: `thumbs.write_thumbnail(src_path: str, dst_path: str) -> None` — loeb `src_path` pildi, kirjutab 400×600 JPEG (quality 85) `dst_path`-i **atomaarselt**. Kasutavad nii `thumbs._create_thumbnail` kui `prepress_apply` (Task 3).

- [ ] **Step 1: Kirjuta kukkuv test**

Loo `tests/test_upload_thumbnail_write.py`:

```python
"""Pisipilt kirjutatakse atomaarselt.

Ilma selleta näeb paralleelne HTTP GET (`/admin/upload/{id}/thumb/{n}`) või
teine poll poolikut JPEG-i. See on olemasolev latentne viga: `_create_thumbnail`
salvestas PIL-iga otse lõppteele.
"""
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server.upload import thumbs as upload_thumbs


def _pilt(path, suurus=(1200, 1600)):
    from PIL import Image
    Image.new("RGB", suurus, (200, 180, 160)).save(path, "JPEG", quality=95)


def test_write_thumbnail_mahutab_400x600_kasti(tmp_path):
    src = tmp_path / "src.jpg"
    dst = tmp_path / "001.jpg"
    _pilt(src)

    upload_thumbs.write_thumbnail(str(src), str(dst))

    from PIL import Image
    with Image.open(dst) as im:
        assert im.size[0] <= 400 and im.size[1] <= 600


def test_write_thumbnail_ei_jata_tmp_faili(tmp_path):
    src = tmp_path / "src.jpg"
    dst = tmp_path / "001.jpg"
    _pilt(src)

    upload_thumbs.write_thumbnail(str(src), str(dst))

    assert os.listdir(tmp_path) == sorted(["src.jpg", "001.jpg"]) or set(
        os.listdir(tmp_path)) == {"src.jpg", "001.jpg"}


def test_write_thumbnail_ei_jata_poolikut_faili_vea_korral(tmp_path):
    """Kukkumine ei tohi jätta lõppteele poolikut pilti."""
    src = tmp_path / "katki.jpg"
    src.write_bytes(b"see ei ole JPEG")
    dst = tmp_path / "001.jpg"

    with pytest.raises(Exception):
        upload_thumbs.write_thumbnail(str(src), str(dst))

    assert not dst.exists(), "lõppteele ei tohi jääda midagi"
```

- [ ] **Step 2: Jooksuta test, veendu kukkumises**

Run: `.venv/bin/pytest tests/test_upload_thumbnail_write.py -v`
Expected: FAIL — `AttributeError: module 'server.upload.thumbs' has no attribute 'write_thumbnail'`

- [ ] **Step 3: Teosta `write_thumbnail` ja suuna `_create_thumbnail` sellele**

`server/upload/thumbs.py`, asenda `_create_thumbnail` plokk:

```python
THUMB_BOX = (400, 600)
THUMB_QUALITY = 85


def write_thumbnail(src_path: str, dst_path: str) -> None:
    """Kirjutab pildist pisipildi ATOMAARSELT (`.tmp` + `os.replace`).

    Atomaarsus ei ole ilutsemine: `/admin/upload/{id}/thumb/{n}` serveerib seda
    faili otse ja poll võib samal ajal sama nime kirjutada. Otse lõppteele
    salvestamine (endine käitumine) lasi lugejal näha poolikut JPEG-i.

    Kutsuvad NII poll (SFTP-ga alla laaditud pildist) KUI prepress_apply
    (kohapeal renderdatud 300 DPI pildist).
    """
    from PIL import Image

    tmp_path = dst_path + ".tmp"
    try:
        with Image.open(src_path) as img:
            thumb = img.convert("RGB")
            thumb.thumbnail(THUMB_BOX, Image.LANCZOS)
            thumb.save(tmp_path, "JPEG", quality=THUMB_QUALITY)
        os.replace(tmp_path, dst_path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def _create_thumbnail(sftp, remote_jpg: str, tmp_thumb: str, thumb_path: str):
    """Laeb remote JPG-i alla ja salvestab sellest lokaalse pisipildi.

    Õhuke SFTP-ümbris `write_thumbnail`-i ümber. `tmp_thumb` on ALLALAADIMISE
    ajutine fail (mitte pisipildi oma) ja jääb kutsuja omandisse — poll kasutab
    selle olemasolu märgina „teine lõim juba laadib".
    """
    sftp.get(remote_jpg, tmp_thumb)
    write_thumbnail(tmp_thumb, thumb_path)
    os.unlink(tmp_thumb)
```

- [ ] **Step 4: Jooksuta testid**

Run: `.venv/bin/pytest tests/test_upload_thumbnail_write.py tests/test_upload_placeholders.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/upload/thumbs.py tests/test_upload_thumbnail_write.py
git commit -m "fix(upload): pisipilt kirjutatakse atomaarselt (.tmp + os.replace)"
```

---

### Task 3: `prepress_apply` kirjutab pisipildi — mitte-fataalselt

**Files:**
- Modify: `server/upload/prepress_apply.py:44-105` (`_transfer_pages`)
- Test: `tests/test_prepress_apply_thumbs.py` (uus)

**Interfaces:**
- Consumes: `thumbs.write_thumbnail(src, dst)` (Task 2)
- Produces: apply kõrvalmõjuna `uploads/{id}/thumbs/{out_index:03d}.jpg` iga avaldatud lehe kohta

- [ ] **Step 1: Kirjuta kukkuvad testid**

Loo `tests/test_prepress_apply_thumbs.py`:

```python
"""Apply kirjutab pisipildi sealsamas, kus 300 DPI pilt juba kettal on.

Null SFTP-d, null lisarenderdust — ja see teeb võimalikuks I2 (poll ei tõmba
apply ajal midagi tagasi).
"""
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server.upload import prepress_apply, state as upload_state


class _SFTP:
    def __init__(self):
        self.avaldatud = []

    def close(self):
        pass


@pytest.fixture
def apply_env(tmp_path, monkeypatch):
    """Renderdus ja SFTP asendatud; ainus päris asi on failisüsteem."""
    uploads = tmp_path / "uploads"
    (uploads / "u1" / "thumbs").mkdir(parents=True)
    monkeypatch.setattr(upload_state, "UPLOADS_DIR", str(uploads))
    monkeypatch.setattr(prepress_apply.upload_state, "UPLOADS_DIR", str(uploads))

    src = tmp_path / "source.pdf"
    src.write_bytes(b"%PDF-1.4 fake")
    monkeypatch.setattr(prepress_apply.prepress, "source_path", lambda uid: str(src))

    class _Source:
        def page_count(self):
            return 2

        def render_full(self, n, dst):
            from PIL import Image
            Image.new("RGB", (1200, 1600), (n * 40, 120, 160)).save(
                dst, "JPEG", quality=95)

    monkeypatch.setattr(prepress_apply.page_source, "open_page_source",
                        lambda p: _Source())
    sftp = _SFTP()
    monkeypatch.setattr(prepress_apply.ocr_client, "sftp_open", lambda uid: sftp)
    monkeypatch.setattr(prepress_apply.ocr_client, "ensure_remote_dirs",
                        lambda s, d: None)
    monkeypatch.setattr(prepress_apply, "publish_atomic",
                        lambda s, local, remote: sftp.avaldatud.append(remote))
    return uploads, sftp


def _plaan():
    return {"default_split_x": 0.5, "pages": [
        {"n": 1, "mode": "nosplit", "split_x": None, "excluded": False},
        {"n": 2, "mode": "nosplit", "split_x": None, "excluded": False},
    ]}


def test_apply_kirjutab_pisipildi_iga_avaldatud_lehe_kohta(apply_env):
    uploads, sftp = apply_env

    sent = prepress_apply._transfer_pages(
        "u1", "1651-teos", ("/srv/st", "/srv/st/w"), "/srv/st/w", _plaan())

    assert sent == 2
    thumbs = sorted(os.listdir(uploads / "u1" / "thumbs"))
    assert thumbs == ["001.jpg", "002.jpg"]


def test_pisipildi_viga_ei_katkesta_apply_d(apply_env, monkeypatch):
    """Kaugpilt on selleks hetkeks juba avaldatud — tuletatud UI-artefakti
    pärast ei tohi OCR-i konveierit maha võtta."""
    uploads, sftp = apply_env

    def _kukub(src, dst):
        raise OSError("ketas täis")

    monkeypatch.setattr(prepress_apply.thumbs, "write_thumbnail", _kukub)

    sent = prepress_apply._transfer_pages(
        "u1", "1651-teos", ("/srv/st", "/srv/st/w"), "/srv/st/w", _plaan())

    assert sent == 2, "avaldamine peab lõpuni jooksma"
    assert len(sftp.avaldatud) == 2
```

- [ ] **Step 2: Jooksuta testid, veendu kukkumises**

Run: `.venv/bin/pytest tests/test_prepress_apply_thumbs.py -v`
Expected: FAIL — `thumbs` kaustas ei ole ühtki faili (`assert thumbs == [...]`)

- [ ] **Step 3: Lisa import ja pisipildi kirjutamine**

`server/upload/prepress_apply.py`, importide juurde:

```python
from . import ocr_client, page_source, prepress, prepress_plan, thumbs
```

`_transfer_pages` sees, `work_dir` kõrvale:

```python
    thumbs_dir = os.path.join(upload_state.upload_dir(upload_id), "thumbs")
    os.makedirs(thumbs_dir, exist_ok=True)
```

ja avaldamise plokis:

```python
                for (x0, x1) in prepress_plan.page_cuts(plan, n, width):
                    out_index += 1
                    name = remote_page_name(slug, out_index)
                    cut = os.path.join(work_dir, name)
                    try:
                        _write_cut(full, x0, x1, cut)
                        publish_atomic(sftp, cut, "{}/{}".format(remote_work, name))
                        # Pisipilt SIIN: pikslid on juba kettal, SFTP-d ei ole
                        # vaja. Viga EI TOHI apply't katkestada — kaugpilt on
                        # selleks hetkeks juba avaldatud ja OCR võib alata;
                        # puuduva pisipildi taastab `processing`-aegne backfill.
                        try:
                            thumbs.write_thumbnail(
                                cut,
                                os.path.join(thumbs_dir, "{:03d}.jpg".format(out_index)),
                            )
                        except Exception as e:
                            logger.warning(
                                "Pisipilt {} lk {}: {}".format(upload_id, out_index, e))
                    finally:
                        if os.path.exists(cut):
                            os.unlink(cut)
```

- [ ] **Step 4: Jooksuta testid**

Run: `.venv/bin/pytest tests/test_prepress_apply_thumbs.py -v`
Expected: PASS

- [ ] **Step 5: Kontrolli, et tsükliline import puudub**

Run: `.venv/bin/python -c "import server.upload.prepress_apply"`
Expected: vigadeta. (`thumbs` impordib `state`, `file_detection`, `prepress_plan`, `ocr_client` — mitte `prepress_apply`-d, seega tsüklit ei teki.)

- [ ] **Step 6: Commit**

```bash
git add server/upload/prepress_apply.py tests/test_prepress_apply_thumbs.py
git commit -m "feat(upload): apply kirjutab pisipildi kohapeal, ilma SFTP-tagasitõmbeta"
```

---

### Task 4: `can_copy_source_bytes` — pildikausta lehed ilma ümberkodeerimiseta

**Files:**
- Modify: `server/upload/page_source.py` (uus `source_file`)
- Modify: `server/upload/prepress_apply.py` (`_transfer_pages` kiirtee)
- Test: `tests/test_prepress_apply_bytecopy.py` (uus)

**Interfaces:**
- Produces: `page_source.PageSource.source_file(n) -> Optional[str]` — lähtefaili tee, kui allikas on failipõhine (pildikaust); `None` PDF-i korral.
- Produces: `prepress_apply.can_copy_source_bytes(source, plan, n, width) -> bool`

- [ ] **Step 1: Kirjuta kukkuvad testid**

Loo `tests/test_prepress_apply_bytecopy.py`:

```python
"""Pildikausta leht kopeeritakse baithaaval, kui teisendust ei ole.

`ImageDirPageSource.render_full` teeb `convert("RGB").save(quality=95)` — see on
JPEG ümberkodeerimine. Tänane otsetee (`_transfer_images_thread`) saadab
originaalbaidid; ühendamine ei tohi kvaliteeti kaotada.

Vertikaalset mõõdet EI kontrollita: `page_cuts` annab ainult (x0, x1) ja
`_write_cut` lõikab alati täiskõrguse.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server.upload import page_source, prepress_apply


def _pildikaust(tmp_path, exif_orientation=None):
    kaust = tmp_path / "source"
    kaust.mkdir()
    from PIL import Image
    for i in (1, 2):
        im = Image.new("RGB", (800, 1000), (100, 100 + i * 20, 140))
        if exif_orientation is not None:
            exif = im.getexif()
            exif[274] = exif_orientation          # 274 = Orientation
            im.save(kaust / "lk{}.jpg".format(i), "JPEG", quality=88, exif=exif)
        else:
            im.save(kaust / "lk{}.jpg".format(i), "JPEG", quality=88)
    return kaust


def _plaan(mode="nosplit"):
    return {"default_split_x": 0.5, "pages": [
        {"n": 1, "mode": mode, "split_x": None, "excluded": False},
        {"n": 2, "mode": mode, "split_x": None, "excluded": False},
    ]}


def test_source_file_annab_pildikausta_tee(tmp_path):
    src = page_source.open_page_source(str(_pildikaust(tmp_path)))
    assert src.source_file(1).endswith("lk1.jpg")


def test_source_file_on_none_pdf_i_korral(tmp_path):
    pdf = tmp_path / "a.pdf"
    pdf.write_bytes(b"%PDF-1.4")
    src = page_source.open_page_source(str(pdf))
    assert src.source_file(1) is None


def test_identity_loige_lubab_baitkoopia(tmp_path):
    src = page_source.open_page_source(str(_pildikaust(tmp_path)))
    assert prepress_apply.can_copy_source_bytes(src, _plaan(), 1, 800) is True


def test_poolitus_ei_luba_baitkoopiat(tmp_path):
    src = page_source.open_page_source(str(_pildikaust(tmp_path)))
    assert prepress_apply.can_copy_source_bytes(src, _plaan("default"), 1, 800) is False


def test_exif_poore_ei_luba_baitkoopiat(tmp_path):
    """PIL viskab EXIF-i ära; baithaaval koopia säilitab selle. Kaks teed
    annaksid erineva nähtava orientatsiooni."""
    src = page_source.open_page_source(str(_pildikaust(tmp_path, exif_orientation=6)))
    assert prepress_apply.can_copy_source_bytes(src, _plaan(), 1, 800) is False


def test_exif_orientation_1_lubab_baitkoopia(tmp_path):
    src = page_source.open_page_source(str(_pildikaust(tmp_path, exif_orientation=1)))
    assert prepress_apply.can_copy_source_bytes(src, _plaan(), 1, 800) is True


def test_pdf_ei_luba_kunagi_baitkoopiat(tmp_path):
    pdf = tmp_path / "a.pdf"
    pdf.write_bytes(b"%PDF-1.4")
    src = page_source.open_page_source(str(pdf))
    assert prepress_apply.can_copy_source_bytes(src, _plaan(), 1, 800) is False
```

- [ ] **Step 2: Jooksuta testid, veendu kukkumises**

Run: `.venv/bin/pytest tests/test_prepress_apply_bytecopy.py -v`
Expected: FAIL — `PageSource` objektil puudub `source_file`; `prepress_apply` objektil puudub `can_copy_source_bytes`

- [ ] **Step 3: Lisa `source_file` `page_source.py`-sse**

`PageSource` baasklassi:

```python
    def source_file(self, n: int) -> Optional[str]:
        """Lähtefaili tee, kui leht ON juba fail. PDF-il ei ole — tagastab None.

        Võimaldab baithaaval kopeerimist seal, kus teisendust ei ole vaja
        (vt prepress_apply.can_copy_source_bytes).
        """
        return None
```

`ImageDirPageSource`-i:

```python
    def source_file(self, n: int) -> Optional[str]:
        try:
            return self._path(n)
        except IndexError:
            return None
```

- [ ] **Step 4: Lisa `can_copy_source_bytes` `prepress_apply.py`-sse**

```python
def can_copy_source_bytes(source, plan: Optional[dict], n: int, width: int) -> bool:
    """Kas lehe N võib avaldada originaalbaitidena, ilma PIL-i läbimata.

    Tingimused on tahtlikult ranged — see peab olema PÄRIS identity-teisendus:
      1. allikas on failipõhine (pildikaust, mitte PDF)
      2. `page_cuts` annab TÄPSELT ühe lõike, mis katab kogu laiuse
         (vertikaalset lõikamist andmemudelis ei eksisteeri)
      3. fail on JPEG — LOSS võtab selle muutmata vastu
      4. EXIF orientation puudub või on 1

    Punkt 4 on see, mis kergesti märkamata jääb: PIL-i `convert("RGB").save()`
    viskab EXIF-i ära, baithaaval koopia säilitab selle. Pöördega JPEG näeks
    kahel teel erinev välja.
    """
    path = source.source_file(n)
    if not path:
        return False
    if not path.lower().endswith((".jpg", ".jpeg")):
        return False
    cuts = prepress_plan.page_cuts(plan, n, width)
    if cuts != [(0, width)]:
        return False
    try:
        from PIL import Image
        with Image.open(path) as im:
            if im.getexif().get(274, 1) != 1:      # 274 = Orientation
                return False
    except Exception:
        return False
    return True
```

- [ ] **Step 5: Jooksuta predikaadi testid**

Run: `.venv/bin/pytest tests/test_prepress_apply_bytecopy.py -v`
Expected: PASS

- [ ] **Step 6: Kasuta kiirteed `_transfer_pages`-is**

`_transfer_pages` tsüklis, `with prepress.RENDER_SEMAPHORE:` ploki asemel:

```python
            # Baithaaval kiirtee: pildikausta leht, millel teisendust ei ole.
            # `width` tuleb metaandmetest — rasteriseerimist ei toimu.
            kiirtee = None
            proov = source.source_file(n)
            if proov:
                try:
                    from PIL import Image
                    with Image.open(proov) as im:
                        proovi_laius = im.size[0]
                    if can_copy_source_bytes(source, plan, n, proovi_laius):
                        kiirtee = proov
                except Exception as e:
                    logger.warning("Baitkoopia kontroll {} lk {}: {}".format(
                        upload_id, n, e))

            if kiirtee:
                out_index += 1
                name = remote_page_name(slug, out_index)
                publish_atomic(sftp, kiirtee, "{}/{}".format(remote_work, name))
                try:
                    thumbs.write_thumbnail(
                        kiirtee,
                        os.path.join(thumbs_dir, "{:03d}.jpg".format(out_index)),
                    )
                except Exception as e:
                    logger.warning("Pisipilt {} lk {}: {}".format(
                        upload_id, out_index, e))
                upload_state.mutate_prepress(
                    upload_id, lambda p, n=n: p.update(applied_done=n)
                )
                continue

            full = os.path.join(work_dir, "full.jpg")
            with prepress.RENDER_SEMAPHORE:
                source.render_full(n, full)
            ...  # senine keha muutmata
```

- [ ] **Step 7: Lisa kiirtee integratsioonitest**

Lisa `tests/test_prepress_apply_bytecopy.py` lõppu:

```python
def test_kiirtee_avaldab_originaalbaidid(tmp_path, monkeypatch):
    """Avaldatud fail peab olema BAIT-IDENTNE lähtefailiga."""
    from server.upload import state as upload_state

    uploads = tmp_path / "uploads"
    (uploads / "u1" / "thumbs").mkdir(parents=True)
    monkeypatch.setattr(upload_state, "UPLOADS_DIR", str(uploads))
    monkeypatch.setattr(prepress_apply.upload_state, "UPLOADS_DIR", str(uploads))
    upload_state.write_state("u1", {"id": "u1", "status": "applying",
                                    "meta": {"slug": "x"}, "prepress": _plaan()})

    kaust = _pildikaust(tmp_path)
    monkeypatch.setattr(prepress_apply.prepress, "source_path", lambda uid: str(kaust))

    avaldatud = []

    class _S:
        def close(self):
            pass

    monkeypatch.setattr(prepress_apply.ocr_client, "sftp_open", lambda uid: _S())
    monkeypatch.setattr(prepress_apply.ocr_client, "ensure_remote_dirs",
                        lambda s, d: None)
    monkeypatch.setattr(prepress_apply, "publish_atomic",
                        lambda s, local, remote: avaldatud.append(local))

    prepress_apply._transfer_pages(
        "u1", "x", ("/srv/st", "/srv/st/w"), "/srv/st/w", _plaan())

    assert len(avaldatud) == 2
    assert Path(avaldatud[0]).read_bytes() == (kaust / "lk1.jpg").read_bytes()
```

- [ ] **Step 8: Jooksuta testid**

Run: `.venv/bin/pytest tests/test_prepress_apply_bytecopy.py tests/test_prepress_apply_thumbs.py -v`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add server/upload/page_source.py server/upload/prepress_apply.py tests/test_prepress_apply_bytecopy.py
git commit -m "feat(upload): pildikausta leht avaldatakse baithaaval, kui teisendust ei ole"
```

---

### Task 5: Marsruutimine — üks tee; `store_source` edastus ja `pdf_subset` pensionile

**Files:**
- Modify: `server/routers/upload.py:185-208` (`admin_prepress_apply`)
- Modify: `server/upload/store_source.py` (eemalda `transfer_stored_source`, `_transfer_pdf_thread`, `_transfer_images_thread`)
- Delete: `server/upload/pdf_subset.py`
- Modify: `server/__init__.py` (kui seal on re-eksporte eemaldatavatele nimedele)
- Test: `tests/test_upload_apply_routing.py` (uus)

**Interfaces:**
- Consumes: `prepress_apply.start_apply(upload_id) -> bool` (olemas)

- [ ] **Step 1: Kirjuta kukkuv test**

Loo `tests/test_upload_apply_routing.py`:

```python
"""Üks tee: ka triviaalne plaan läheb VUTT-i rasterduse kaudu.

Varem hargnes apply `is_trivial_plan` järgi: triviaalne → originaal-PDF LOSSi,
kus `expand_pdf` blokeeris kuni viimase leheni. Nüüd materialiseerib VUTT
lehed alati ja LOSS alustab OCR-i esimesest lehest.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def test_triviaalne_plaan_laheb_start_apply_kaudu(client, login, make_upload, monkeypatch):
    from server.upload import prepress_apply, state as upload_state

    upload_dir, _ = make_upload("upl123", status="awaiting_split", expected_pages=2)
    upload_state.set_upload_state("upl123", prepress={
        "default_split_x": 0.5,
        "pages": [
            {"n": 1, "mode": "nosplit", "split_x": None, "excluded": False},
            {"n": 2, "mode": "nosplit", "split_x": None, "excluded": False},
        ],
    })

    kutsutud = []
    monkeypatch.setattr(prepress_apply, "start_apply",
                        lambda uid: kutsutud.append(uid) or True)

    token = login("admin")
    r = client.post("/admin/upload/upl123/prepress/apply",
                    headers={"Authorization": "Bearer {}".format(token)})

    assert r.status_code == 200
    assert r.json()["path"] == "split"
    assert kutsutud == ["upl123"]
```

> **NB:** `client` / `login` / `make_upload` on `tests/conftest.py`-s. Kui
> `login` allkirjastus erineb, vaata `tests/conftest.py:204-215` ja kohanda
> kutset — testi SISU (mis marsruudi kaudu apply läheb) jääb samaks.

- [ ] **Step 2: Jooksuta test, veendu kukkumises**

Run: `.venv/bin/pytest tests/test_upload_apply_routing.py -v`
Expected: FAIL — `r.json()["path"] == "original"` ja `kutsutud == []` (triviaalne plaan läheb veel `transfer_stored_source` kaudu)

- [ ] **Step 3: Eemalda haru marsruuterist**

`server/routers/upload.py`, asenda `admin_prepress_apply` keha:

```python
@router.post("/admin/upload/{upload_id}/prepress/apply")
def admin_prepress_apply(upload_id: str, user=Depends(require_role("admin"))):
    """Lõpetab sammu 3. ÜKS tee: VUTT materialiseerib lehed (ADR 0028).

    Varem hargnes `is_trivial_plan` järgi ja saatis triviaalse plaani
    originaal-PDF-ina LOSSi, kus `expand_pdf` rasteriseeris terve faili enne
    esimese JPG kirjutamist — minuteid, mille jooksul ei olnud midagi näidata
    ega OCR-ida. `is_trivial_plan` jääb kokkuvõtete ja UI teadete tarbeks.

    Sync def — try_begin_applying on blokeeriv faililukk (ADR 0002).
    """
    state, _plan = _load_prepress(upload_id)

    if not prepress_apply.start_apply(upload_id):
        return JSONResponse(
            status_code=409,
            content={"detail": "Töö juba käib", "status": state.get("status")},
        )
    return {"status": "applying", "path": "split"}
```

Eemalda `store_source` import, kui teisi kasutusi ei jää:

Run: `grep -n "store_source" server/routers/upload.py`

- [ ] **Step 4: Jooksuta test**

Run: `.venv/bin/pytest tests/test_upload_apply_routing.py -v`
Expected: PASS

- [ ] **Step 5: Eemalda surnud kood**

```bash
grep -rn "transfer_stored_source\|_transfer_pdf_thread\|_transfer_images_thread\|pdf_subset" server/ tests/ scripts/
```

Kustuta `server/upload/pdf_subset.py` ja `store_source.py`-st kolm funktsiooni. Iga leitud kasutuskoht tuleb enne eemaldada — sh testid, mis neid katsid.

Kontrolli `server/__init__.py` re-eksporte:

```bash
grep -n "transfer_stored_source\|pdf_subset" server/__init__.py
```

- [ ] **Step 6: Jooksuta kogu komplekt**

Run: `.venv/bin/pytest tests/ -q`
Expected: PASS. Kustutatud funktsioone katvad testid tuleb eemaldada koos funktsiooniga — mitte kommenteerida välja.

- [ ] **Step 7: Kontrolli, et miski ei impordi kustutatut**

Run: `.venv/bin/python -c "import server.main"`
Expected: vigadeta

- [ ] **Step 8: Commit**

```bash
git add -A server/ tests/
git commit -m "feat(upload): üks tee — triviaalne plaan läheb samuti VUTT-i rasterduse kaudu"
```

---

### Task 6: Katkenud apply retry puhastab kaugfailid

**Files:**
- Modify: `server/upload/prepress_apply.py` (`apply_and_transfer`)
- Test: `tests/test_prepress_apply_retry.py` (uus)

**Interfaces:**
- Consumes: `ocr_client.cleanup_run_files(sftp, remote_dir) -> bool` (olemas)

- [ ] **Step 1: Kirjuta kukkuv test**

Loo `tests/test_prepress_apply_retry.py`:

```python
"""Katkenud apply kordus alustab puhtalt lehelt.

`APPLY_START_STATUSES` sisaldab `error`-it, seega retry ON lubatud. Lehenimed on
deterministlikud, aga juba tekkinud `.txt` failid jääksid alles ja LOSS ei
OCR-iks uuesti — muutunud pildile jääks vana tekst. Seega puhastatakse enne
kordust kaugtöökausta FAILID (mitte kataloog — ADR 0024 / #225).
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server.upload import prepress_apply, state as upload_state


def test_retry_puhastab_kaugfailid_enne_avaldamist(tmp_path, monkeypatch):
    uploads = tmp_path / "uploads"
    (uploads / "u1" / "thumbs").mkdir(parents=True)
    monkeypatch.setattr(upload_state, "UPLOADS_DIR", str(uploads))
    monkeypatch.setattr(prepress_apply.upload_state, "UPLOADS_DIR", str(uploads))
    upload_state.write_state("u1", {
        "id": "u1", "status": "applying", "expected_pages": 1,
        "meta": {"slug": "x"},
        "remote_staging_path": "AUTO-OCR/hand/u1",
        "remote_work_path": "AUTO-OCR/hand/u1/x",
        "prepress": {"default_split_x": 0.5, "pages": [
            {"n": 1, "mode": "nosplit", "split_x": None, "excluded": False},
        ]},
        "apply_attempts": 1,          # ← eelmine katse kukkus
    })

    puhastatud = []
    monkeypatch.setattr(prepress_apply.ocr_client, "cleanup_run_files",
                        lambda sftp, d: puhastatud.append(d) or True)
    monkeypatch.setattr(prepress_apply, "_transfer_pages",
                        lambda *a, **kw: 1)

    prepress_apply.apply_and_transfer("u1")

    assert puhastatud, "korduskatse peab kaugfailid enne puhastama"


def test_esimene_katse_ei_puhasta(tmp_path, monkeypatch):
    """Puhas kaust — puhastamine oleks tarbetu SFTP-ring."""
    uploads = tmp_path / "uploads"
    (uploads / "u2" / "thumbs").mkdir(parents=True)
    monkeypatch.setattr(upload_state, "UPLOADS_DIR", str(uploads))
    monkeypatch.setattr(prepress_apply.upload_state, "UPLOADS_DIR", str(uploads))
    upload_state.write_state("u2", {
        "id": "u2", "status": "applying", "expected_pages": 1,
        "meta": {"slug": "x"},
        "remote_staging_path": "AUTO-OCR/hand/u2",
        "remote_work_path": "AUTO-OCR/hand/u2/x",
        "prepress": {"default_split_x": 0.5, "pages": [
            {"n": 1, "mode": "nosplit", "split_x": None, "excluded": False},
        ]},
    })

    puhastatud = []
    monkeypatch.setattr(prepress_apply.ocr_client, "cleanup_run_files",
                        lambda sftp, d: puhastatud.append(d) or True)
    monkeypatch.setattr(prepress_apply, "_transfer_pages", lambda *a, **kw: 1)

    prepress_apply.apply_and_transfer("u2")

    assert puhastatud == []
```

- [ ] **Step 2: Jooksuta testid, veendu kukkumises**

Run: `.venv/bin/pytest tests/test_prepress_apply_retry.py -v`
Expected: FAIL — `assert puhastatud` (koristust ei toimu)

- [ ] **Step 3: Loenda katseid ja puhasta korduse korral**

`server/upload/state.py`, `try_begin_applying` sees, `s["status"] = "applying"` juurde:

```python
        # Mitmes katse see on. Kordus tähendab, et kaugkaustas võib olla
        # eelmise katse jäänuk — vt apply_and_transfer.
        s["apply_attempts"] = int(s.get("apply_attempts") or 0) + 1
```

`server/upload/prepress_apply.py`, `apply_and_transfer` sees, enne `_transfer_pages`:

```python
    try:
        # Kordus alustab puhtalt lehelt: eelmise katse `.jpg`/`.txt` jäänukid
        # eksitaksid LOSSi (olemasolev .txt tähendab „juba OCR-itud") ja
        # muutunud pildile jääks vana tekst. Kustutame FAILID, mitte kataloogi
        # (ADR 0024 / #225: kadunud kataloog lennusoleva batchi alt kukutab
        # kogu OCR-teenuse).
        if int(state.get("apply_attempts") or 0) > 1:
            sftp = ocr_client.sftp_open(upload_id)
            try:
                ocr_client.cleanup_run_files(sftp, remote_work)
                logger.info("Apply kordus {}: kaugfailid puhastatud".format(upload_id))
            finally:
                try:
                    sftp.close()
                except Exception:
                    pass

        sent = _transfer_pages(...)
```

- [ ] **Step 4: Jooksuta testid**

Run: `.venv/bin/pytest tests/test_prepress_apply_retry.py tests/test_upload_apply_poll.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/upload/prepress_apply.py server/upload/state.py tests/test_prepress_apply_retry.py
git commit -m "feat(upload): apply kordus puhastab kaugfailid (cleanup_run_files, mitte rm -rf)"
```

---

### Task 7: `WEB_CONCURRENCY` käivitushoiatus

**Files:**
- Modify: `server/config.py` (`check_production_secrets` kõrvale)
- Test: `tests/test_config_render_concurrency.py` (uus)

**Interfaces:**
- Produces: `config.check_render_concurrency() -> Optional[str]` — hoiatuse tekst või `None`

- [ ] **Step 1: Kirjuta kukkuv test**

Loo `tests/test_config_render_concurrency.py`:

```python
"""`RENDER_SEMAPHORE(1)` on PROTSESSI-lokaalne.

Pärast ADR 0028 läbivad KÕIK upload'id rasterduse, seega mitme workeri
käivitamine tähendaks mitut samaaegset 300 DPI renderdust ilma ühegi
piiranguta. Hoiatus on odavam kui aasta pärast juhtumi uurimine.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import config


def test_uks_worker_ei_hoiata(monkeypatch):
    monkeypatch.delenv("WEB_CONCURRENCY", raising=False)
    monkeypatch.delenv("UVICORN_WORKERS", raising=False)
    assert config.check_render_concurrency() is None


def test_mitu_workerit_hoiatab(monkeypatch):
    monkeypatch.setenv("WEB_CONCURRENCY", "4")
    assert "RENDER_SEMAPHORE" in (config.check_render_concurrency() or "")


def test_uvicorn_workers_hoiatab_samuti(monkeypatch):
    monkeypatch.delenv("WEB_CONCURRENCY", raising=False)
    monkeypatch.setenv("UVICORN_WORKERS", "2")
    assert config.check_render_concurrency() is not None
```

- [ ] **Step 2: Jooksuta test, veendu kukkumises**

Run: `.venv/bin/pytest tests/test_config_render_concurrency.py -v`
Expected: FAIL — `AttributeError: module 'server.config' has no attribute 'check_render_concurrency'`

- [ ] **Step 3: Teosta kontroll**

`server/config.py` lõppu:

```python
def check_render_concurrency():
    """Hoiatab, kui protsesse on rohkem kui üks.

    `prepress.RENDER_SEMAPHORE(1)` piirab rasterdust ÜHE protsessi sees. Pärast
    ADR 0028 läbivad kõik upload'id rasterduse, seega mitu workerit tähendaks
    mitut samaaegset 300 DPI renderdust ilma ühegi piiranguta. Tagastab
    hoiatuse teksti või None.
    """
    for nimi in ("WEB_CONCURRENCY", "UVICORN_WORKERS", "GUNICORN_WORKERS"):
        try:
            workereid = int(os.getenv(nimi, "1") or "1")
        except ValueError:
            continue
        if workereid > 1:
            return (
                "{}={}: RENDER_SEMAPHORE(1) on protsessi-lokaalne. Enne mitme "
                "workeri kasutamist tuleb see asendada protsessideülese lukuga "
                "(ADR 0028), muidu renderdab masin korraga {} 300 DPI PDF-i."
            ).format(nimi, workereid, workereid)
    return None
```

- [ ] **Step 4: Kutsu see käivitusel välja**

`server/main.py` lifespan'i alguses:

```python
    hoiatus = config.check_render_concurrency()
    if hoiatus:
        logger.warning(hoiatus)
```

- [ ] **Step 5: Jooksuta testid**

Run: `.venv/bin/pytest tests/test_config_render_concurrency.py -v && .venv/bin/pytest tests/ -q`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/config.py server/main.py tests/test_config_render_concurrency.py
git commit -m "feat(config): hoiata, kui workereid on üle ühe (RENDER_SEMAPHORE on protsessi-lokaalne)"
```

---

### Task 8: Frontend — apply-faasi teade ja `processingStartedAt`

**Files:**
- Modify: `src/pages/upload/useUploadWizard.ts:101,198,229,238,265,268,515,549`
- Modify: `src/pages/upload/utils.ts:81,94,117,121,137`
- Modify: `src/pages/upload/components/UploadStepReview.tsx:171-176`
- Modify: `src/locales/et/upload.json`, `src/locales/en/upload.json`
- Test: `src/pages/upload/__tests__/utils.test.ts`

**Interfaces:**
- Produces: `computeReviewDerived(pollResult, localDeleted, processingStartedAt, importLoading, now, sendProgress)` — kolmas parameeter ümber nimetatud, tüüp sama (`number | null`)

- [ ] **Step 1: Kirjuta kukkuv test**

Lisa `src/pages/upload/__tests__/utils.test.ts` lõppu:

```ts
describe('applying-faas', () => {
  it('EI loe apply aega OCR-i timeouti sisse', () => {
    // OCR algab juba applying ajal, aga timeout mõõdab hetkest, mil KÕIK
    // sisendlehed on avaldatud (= processing). Apply võib 200-lehelisel tööl
    // kesta 9 minutit — see ei tohi timeouti ära süüa.
    const tulem = computeReviewDerived(
      { status: 'applying', ready: 0, total: 0, expected_pages: 192, files: [] },
      new Set(), null, false, Date.now(), null,
    );
    expect(tulem.ocrTimedOut).toBe(false);
  });
});
```

- [ ] **Step 2: Jooksuta test**

Run: `npx vitest run src/pages/upload/__tests__/utils.test.ts`
Expected: PASS juba praegu (`processingStartedAt === null` → `ocrTimedOut` false). See test on **regressioonilukk** ümbernimetamise ajaks — kui keegi seab ajatempli `applying` ajal, hakkab ta kukkuma.

- [ ] **Step 3: Nimeta ümber `ocrStartedAt` → `processingStartedAt`**

```bash
grep -rn "ocrStartedAt\|setOcrStartedAt" src/pages/upload/
```

Asenda kõik esinemised. `utils.ts` parameetri juurde kommentaar:

```ts
  /** Millal jõuti `processing`-usse ehk millal KÕIK sisendlehed olid
   *  avaldatud. EI ole OCR-i algus — OCR jookseb juba `applying` ajal,
   *  lehthaaval (ADR 0028). Vana nimi `ocrStartedAt` valetas. */
  processingStartedAt: number | null,
```

- [ ] **Step 4: Seo ajatempel `processing`-uga, mitte 4. sammu avanemisega**

`useUploadWizard.ts`, `fetchStatus`-is asenda:

```ts
        if (REVIEW_STATUSES.includes(d.status)) {
          setStep(4);
          // Ajatempel EI alga `applying` ajal: sel ajal alles avaldatakse
          // lehti ja OCR jookseb nendega paralleelselt. Timeout mõõdab
          // hetkest, mil sisendvoog on suletud.
          if (d.status !== 'applying' && processingStartedAt === null) {
            setProcessingStartedAt(Date.now());
          }
        }
```

Sama muudatus `handlePrepressApplied`-is (rida ~265): eemalda sealt ajatempli seadmine täielikult — `fetchStatus` teeb selle, kui staatus `processing`-usse jõuab.

- [ ] **Step 5: Lisa apply-faasi teade**

`src/locales/et/upload.json`, `step3` alla:

```json
    "applying": "Renderdan ja saadan lehti… {{done}}/{{total}}",
```

`src/locales/en/upload.json`, samasse kohta:

```json
    "applying": "Rendering and sending pages… {{done}}/{{total}}",
```

`UploadStepReview.tsx`, staatuse-märgises (praegu `t('step3.processing')` haru):

```tsx
        ) : status === 'applying' ? (
          <span className="flex items-center gap-1 text-amber-600 font-medium">
            <Clock size={16} />
            {t('step3.applying')
              .replace('{{done}}', String(pollResult?.progress?.applied_done ?? 0))
              .replace('{{total}}', String(pollResult?.planned_pages ?? 0))}
          </span>
        ) : (
```

> `applied_done` tuleb `prepress` plaanist. Kui `PollResult.progress` seda ei
> kanna, lisa `thumbs._payload`-i väli
> `"applied_done": (state.get("prepress") or {}).get("applied_done", 0)` ja
> `PollResult` tüüpi `applied_done?: number` — `_payload` on staatuse-vastuse
> ÜKS kuju, iga uus väli läheb AINULT sinna.

- [ ] **Step 6: Jooksuta väravad**

Run: `npm run typecheck && npm test && npm run lint:ci`
Expected: typecheck vaikib, vitest roheline, lint ≤ 55 hoiatust

- [ ] **Step 7: Kontrolli i18n pariteeti**

Run: `npx vitest run src/locales`
Expected: PASS (`localeParity.test.ts` nõuab et/en võtmestiku identsust)

- [ ] **Step 8: Commit**

```bash
git add src/pages/upload src/locales server/upload/thumbs.py
git commit -m "feat(upload): apply on nähtav faas; ocrStartedAt → processingStartedAt"
```

---

### Task 9: ADR 0028, CLAUDE.md ja #278 sulgemine

**Files:**
- Create: `docs/decisions/0028-vutt-materialiseerib-ocr-lehed.md`
- Modify: `docs/decisions/0017-poolitamine-enne-ocr.md`, `docs/decisions/0026-ulevaatus-on-alati-nahtav.md` (viide uuele)
- Modify: `docs/decisions/README.md` (register)
- Modify: `CLAUDE.md` (invariandi plokk „Poolitamine enne OCR-i")

- [ ] **Step 1: Kirjuta ADR 0028**

Vorm: vaata `docs/decisions/0026-ulevaatus-on-alati-nahtav.md`. Sisu peab
eksplitsiitselt sisaldama:

- **Otsus:** VUTT materialiseerib OCR-i lehed (rasterdus VÕI identity-baitkoopia); LOSS ainult OCR-ib. Pealkirjas mitte „rasteriseerib alati" — pildikausta baitkoopia ei ole rasterdus.
- **I1:** kuni staatus on `applying`, ei muuda poll upload'i põhistaatust. Põhjendus: `elif all_page_nums: new_status = "reviewing"` kirjutaks staatuse üle juba esimese JPG-d näinud polliga.
- **I2:** `applying` ajal ei laadi poll ühtki kaug-JPG-d alla. Põhjendus: aken `publish_atomic` ja `write_thumbnail` vahel.
- **I3:** apply ja poll ei jaga sama `SFTPClient`-i; jagatud on ainult `paramiko.Transport`.
- **`expected_pages` invariant** koos näitega, miks „`expected_pages == 178` ja `planned_pages == 192` korraga" oli eksitav.
- **`RENDER_SEMAPHORE` protsessi-lokaalsus** kui blokeeriv eeltingimus mitme workeri jaoks.
- **Mida see EI tühista:** ADR 0017 poolitamise mehaanika ja ADR 0026 „ülevaatus on alati nähtav" jäävad kehtima; tühistatav on kitsalt „300 DPI on opt-in".

- [ ] **Step 2: Lisa viited vanadesse ADR-idesse**

Mõlemasse (`0017`, `0026`) päise alla:

```markdown
> **Osaliselt asendatud:** [ADR 0028](0028-vutt-materialiseerib-ocr-lehed.md) —
> 300 DPI läbikäik EI OLE enam opt-in; VUTT materialiseerib lehed alati.
> Ülejäänud otsused siin kehtivad.
```

- [ ] **Step 3: Uuenda ADR-registrit**

Lisa rida `docs/decisions/README.md`-sse, olemasoleva vormi järgi.

- [ ] **Step 4: Kirjuta ümber CLAUDE.md invariandi plokk**

Asenda plokk **„Poolitamine enne OCR-i (ADR 0017, 0026)"** — praegu ütleb ta
„**opt-in on ainult 300 DPI läbikäik**" ja „poolitusteta plaan ei renderda ühtki
300 DPI pikslit". Uus tekst peab ütlema:

- VUTT materialiseerib lehed ALATI ja avaldab lehthaaval; LOSS ainult OCR-ib
- I1 / I2 / I3 ühe lausega kumbki
- `expected_pages` invariant
- `FULL_DPI`/`JPEG_QUALITY` peavad endiselt kattuma OCR-serveri väärtustega
- `mutate_prepress`, apply CAS ja `preview_cancel` reeglid jäävad muutmata

- [ ] **Step 5: Kontrolli, et dokumentatsioon ei viita kustutatule**

```bash
grep -rn "pdf_subset\|transfer_stored_source" docs/ CLAUDE.md
```

Expected: ainult ajaloolistes ADR-ides / `docs/_archive/`-s, mitte elavas juhendis.

- [ ] **Step 6: Commit**

```bash
git add docs/ CLAUDE.md
git commit -m "docs(adr): ADR 0028 — VUTT materialiseerib OCR-i lehed, LOSS ainult OCR-ib"
```

- [ ] **Step 7: Käsitsi kontroll tootmises**

Pärast deploy'd (`./scripts/server_update.sh --no-cache` + `npm run build` +
rsync) proovi neli kuju ja kontrolli igaühel, et **esimene pisipilt ilmub
sekundites** ja LOSSi `.txt`-d tekivad renderdusega paralleelselt:

1. poolitusteta PDF
2. poolitustega PDF
3. mitmepildi-upload — kontrolli baitidentsust:
   `ssh loss 'md5sum <work>/<slug>_pg_001.jpg'` vs lähtefaili `md5sum`
4. poolitusteta PDF **/Rotate + CropBox + eri lehesuurustega** — võrdle
   väljundpilti vana `expand_pdf` tulemusega (mõõtmed, orientatsioon)

Mõõda uuesti sekundid lehe kohta ja uuenda spec'i tabelit — praegune 2,75 s/lk
ei sisalda pisipildi kirjutamist.

- [ ] **Step 8: Sulge #278**

```bash
gh issue close 278 --comment "Lahendatud ADR 0028-ga: VUTT materialiseerib OCR-i lehed lehthaaval ja LOSS ei saa enam upload'idelt PDF-e, seega expand_pdf ei blokeeri ühtki upload'i. LOSSi skripti ei muudetud — käsitsi kausta pandud PDF töötab edasi."
```

---

## Self-review

**Spec coverage:**

| Spec'i nõue | Task |
|---|---|
| I1 — apply ajal poll ei muuda staatust | 1 |
| I2 — apply ajal ei laadita JPG-sid | 1 |
| I3 — SFTP kanalid eraldi (dokumenteerida) | 9 (ADR) |
| `expected_pages` ühe tähendusega | 1 |
| Marsruutimine: üks tee | 5 |
| Pisipilt sünnib apply's, mitte-fataalne | 3 |
| Pisipilt atomaarne | 2 |
| `can_copy_source_bytes` + EXIF | 4 |
| `store_source` edastus + `pdf_subset` pensionile | 5 |
| Katkenud apply retry määratud | 6 |
| `WEB_CONCURRENCY` hoiatus | 7 |
| Apply-faasi teade frontendis | 8 |
| `ocrStartedAt` → `processingStartedAt` | 8 |
| ADR 0028 + CLAUDE.md | 9 |
| Käsitsi kontroll, neli kuju | 9, Step 7 |
| Numbrite ümbermõõtmine | 9, Step 7 |

Katmata jäänud: `VIGASED` kontrolli eemaldamine — spec ütleb otse, et see jääb
esialgu alles ja on eraldi koristus. Teadlik väljajätt, mitte auk.

**Type consistency:** `write_thumbnail(src_path, dst_path)` — Task 2 defineerib,
Task 3 ja 4 kutsuvad sama allkirjaga. `source_file(n) -> Optional[str]` — Task 4
defineerib ja kasutab. `can_copy_source_bytes(source, plan, n, width) -> bool` —
Task 4, üks kutsumiskoht. `check_render_concurrency() -> Optional[str]` — Task 7.
`processingStartedAt` — Task 8, kõigis kolmes failis sama nimi.

**Task-järjekord:** Task 1 peab olema esimene — ta aktiveerib polli apply ajal ja
ilma temata ei ole Task 3 pisipiltidel mõju. Task 2 enne 3-e (`write_thumbnail`
on 3. sõltuvus). Task 5 pärast 3-e ja 4-e: enne seda ei tohi triviaalset plaani
apply teele suunata, sest siis läbiks ta koodi, millel pisipilte veel ei ole.
