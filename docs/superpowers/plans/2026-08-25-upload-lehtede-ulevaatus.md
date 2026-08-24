# Upload'i lehtede ülevaatus — teostusplaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upload'i samm 3 muutub alati nähtavaks lehtede ülevaatuseks, kus lehe saatus (poolitus, OCR-ist väljajätmine, mudel) otsustatakse hulgi ja ENNE OCR-i — ning väljajätmine hakkab päriselt toimima.

**Architecture:** Backend: plaani semantika pöördub ümber (`mode: "nosplit"` on vaikimisi, `enabled` kaob), väljajätmist hakkavad arvestama mõlemad triviaalteed, eelvaade muutub katkestatavaks ja OCR-mudel saab oma state-välja. Frontend: samm 3 saab lehekülgede halduse visuaalse keele — `PageCard`-i karkass, klõps/Shift+klõps valik, hõljuv `PageActionBar`-i stiilis tegevusriba. Kogu uus hulgiloogika elab puhtas moodulis `prepressPlan.ts`, mida testitakse vitestiga; komponendid jäävad õhukesteks.

**Tech Stack:** FastAPI + Python 3.9 (backend), React 19 + TypeScript + Tailwind + Vite (frontend), poppler-utils (`pdfseparate`/`pdfunite`, juba Dockerfile'is), pytest + vitest.

**Spec:** `docs/superpowers/specs/2026-08-24-upload-lehtede-ulevaatus-design.md`

## Global Constraints

- **Koodikommentaarid eesti keeles** (CLAUDE.md).
- **Python 3.9 ühilduvus:** `Optional[dict]`, MITTE `dict | None`.
- **Blokeeriv I/O `async def` sees on keelatud** (ADR 0002) — sync `def` route või `run_in_threadpool`.
- **i18n (ADR 0011):** `fallbackLng` on VÄLJAS. Iga uus võti läheb **`src/locales/et/upload.json` ja `src/locales/en/upload.json` korraga**, samas commitis — muidu kukub `localeParity.test.ts` ja build.
- **`mutate_prepress` on AINUS lubatud viis prepress-alamvälju muuta** — v.a kohad, mis juba hoiavad `get_upload_lock`-i (vt Task 4 hoiatus ummikseisu kohta).
- **`get_upload_lock` tagastab tavalise `threading.Lock`-i, MITTE `RLock`-i.** Luku all olles EI TOHI kutsuda `mutate_prepress`/`set_upload_state`/`try_begin_applying` — need võtavad sama luku ja tulemus on ummikseis.
- **z-index:** täisekraani-modaal `z-[1300]`, tegevusriba `z-[1100]`. `z-50` EI OLE piisav.
- **Number-sisendid:** `type="text" + inputMode="numeric"`, MITTE `type="number"`.
- **Frontendil EI OLE komponenditeste** — `vitest.config.ts` `environment: 'node'`, testing-library puudub. **Selles töös uut testistäkki EI lisata.** Reegel: iga otsustusloogika läheb puhtasse moodulisse (`prepressPlan.ts`) ja saab vitest-testi; komponent jääb vormindajaks ja seda kontrollitakse `npm run typecheck` + `npm run build` + spekki „Kontroll" loendi käsitsi läbimänguga.
- **Väravad iga taski lõpus** (samad jooksevad CI-s):
  - `.venv/bin/pytest tests/` — kasuta ALATI projekti venv-i
  - `npm run typecheck` — Vite EI typecheck'i, `build` üksi ei püüa tüübivigu
  - `npm test`
  - `npm run lint:ci` — lävi `--max-warnings 55`, parandades LANGETA arvu
- **Frontend deploy'takse lokaalselt** (`npm run build && rsync`), backend serveris (`ssh vutt`). Selles plaanis deploy'd EI tehta.

## PR-jaotus

| PR | Haru | Tasks | Miks eraldi |
|---|---|---|---|
| **A** | `fix/upload-valjajatmine-triviaalteel` (main'ist) | 1–2 | Elav tootmisviga: väljajätmine on täna vaikne no-op. Ei sõltu UI-st, läheb main'i eraldi ja **saab CI checkid** (CI jookseb ainult main'i-PR-idel). |
| **B** | `feat/upload-lehtede-ulevaatus` (PR A peale) | 3–11 | Ülejäänud töö. Virnastatud → checke ei saa enne, kui A on main'is; pärast A merge't suuna baas ümber ja tee close+reopen (baasi ümbersuunamine üksi EI käivita CI-d). |

**Enne alustamist:** `git fetch && git log main..origin/main` — kui main on ees, tee `git pull` ENNE haru loomist (vt mälu „Feature-haru tootmises testimine").

## Failistruktuur

| Fail | Vastutus | Task |
|---|---|---|
| `server/upload/pdf_subset.py` | **uus.** Üks funktsioon: ehita PDF-ist alamhulk poppleriga. Ei tea uploadidest ega plaanist midagi. | 2 |
| `server/upload/store_source.py` | Triviaalteede edastus. Saab väljajätmise-teadlikuks; PDF-teel varutee rasterteele. | 1, 2 |
| `server/upload/prepress_plan.py` | Plaani puhas loogika. `default_plan` → `nosplit`, `enabled` maha, uus `normalize_legacy_plan`. | 3 |
| `server/upload/prepress.py` | Renderdus. `preview_cancel` kontroll tsüklis. | 4 |
| `server/upload/state.py` | Olek ja lukud. `APPLY_START_STATUSES`, `preview_cancel` apply CAS-is, uus `try_set_ocr_model`. | 4, 5 |
| `server/upload_ops.py` | `create_upload`. Kaugteede valem läheb jagatud abifunktsiooni. | 5 |
| `server/routers/upload.py` | Endpointid. `enabled` salvestusest maha, legacy-normaliseerimine, uus `POST .../ocr-model`. | 3, 4, 5 |
| `src/pages/upload/prepressPlan.ts` | **Kogu ülevaatuse otsustusloogika.** `enabled` maha, neli hulgioperatsiooni. | 3, 6 |
| `src/pages/upload/types.ts` | `PrepressPlan`/`PrepressPage` kuju. | 3, 4, 5 |
| `src/pages/upload/uploadApi.ts` | API-kliendid. `savePrepress` ilma `enabled`-ita, uus `setOcrModel`. | 3, 5 |
| `src/pages/upload/components/SplitContactSheet.tsx` | Ruudustiku kaart: `PageCard` karkass, valik, kolm nurgaikooni. | 7 |
| `src/pages/upload/components/SplitActionBar.tsx` | **uus.** Hõljuv hulgitegevuste riba (`PageActionBar` karkass 1:1). | 8 |
| `src/pages/upload/components/UploadStepSplit.tsx` | Sammu 3 raam: alati nähtav, päis, valikuolek, ruudustiku juhtnupp. | 9 |
| `src/pages/upload/components/SplitPageDetail.tsx` | Täisvaade: „Ära OCR-i", ümberjärjestatud riba, samad ikoonid. | 10 |
| `docs/decisions/0026-*.md` | ADR: ADR 0017 opt-in-põhimõte muutub. | 11 |

---

# PR A — väljajätmine ei tohi olla vaikne no-op

Spekki „Kaks olemasolevat viga", viga B. Täna: kui poolitusi ei ole, on plaan
„triviaalne" ja originaalfail läheb muutmata OCR-serverisse — väljajäetud leht
OCR-itakse ja imporditakse ikka. See on täpselt see stsenaarium (tühjad lehed,
mis lähevad kordusloopi), mille pärast #255 üldse tekkis.

### Task 1: Väljajätmine toimib pildikausta-teel

Kolmerealine parandus, mis ei vaja poppleri't. Ilma selleta oleks väljajätmine
pooltel upload'idel endiselt no-op.

**Files:**
- Modify: `server/upload/store_source.py` (`_transfer_images_thread`)
- Test: `tests/test_store_source.py`

**Interfaces:**
- Consumes: `prepress_plan.is_excluded(plan, n)`, `prepress_plan.output_page_count(plan, page_count)` (olemas)
- Produces: muutmata avalik liides — `transfer_stored_source(upload_id)` käitub sama, ainult jätab väljajäetud lehed vahele

- [ ] **Step 1: Kirjuta kukkuv test**

Lisa `tests/test_store_source.py` lõppu:

```python
def _fake_sftp(monkeypatch, published):
    """Asendab SFTP-kihi listiga, kuhu publish_atomic kirjutab sihtteed."""
    from server.upload import prepress_apply

    class _Sftp:
        def close(self):
            pass

    monkeypatch.setattr(store_source.ocr_client, "sftp_open", lambda i: _Sftp())
    monkeypatch.setattr(store_source.ocr_client, "ensure_remote_dirs",
                        lambda sftp, dirs: None)
    monkeypatch.setattr(prepress_apply, "publish_atomic",
                        lambda sftp, src, dst: published.append(dst))


def test_valjajaetud_pilt_ei_joua_ocr_serverisse(upload, monkeypatch):
    """Viga B, pildikausta haru: enumerate(listdir) laadis üles KÕIK failid."""
    uid, base = upload
    directory = base / "source"
    directory.mkdir()
    for n in range(1, 5):
        Image.new("RGB", (10, 14), "white").save(directory / "pg_{:03d}.jpg".format(n))
    upload_state.init_prepress(uid, 4)
    upload_state.mutate_prepress(uid, lambda p: p["pages"][1].update(excluded=True))

    published = []
    _fake_sftp(monkeypatch, published)
    monkeypatch.setattr(store_source.threading, "Thread",
                        lambda target, **kw: type("T", (), {"start": target})())

    store_source.transfer_stored_source(uid)

    names = [p.rsplit("/", 1)[-1] for p in published]
    assert len(names) == 3                       # 4 lehte − 1 väljajäetu
    assert names == ["kirik-abc_pg_001.jpg",     # nummerdus jookseb ümber
                     "kirik-abc_pg_002.jpg",
                     "kirik-abc_pg_003.jpg"]


def test_expected_pages_tuleb_plaanist_mitte_lahtefailist(upload, monkeypatch):
    """Ilma selleta ei loe is_stalled tööd kunagi valmis ja samm 4 jääb rippuma."""
    uid, base = upload
    directory = base / "source"
    directory.mkdir()
    for n in range(1, 5):
        Image.new("RGB", (10, 14), "white").save(directory / "pg_{:03d}.jpg".format(n))
    upload_state.init_prepress(uid, 4)
    upload_state.mutate_prepress(uid, lambda p: p["pages"][1].update(excluded=True))
    upload_state.set_upload_state(uid, expected_pages=4)

    _fake_sftp(monkeypatch, [])
    monkeypatch.setattr(store_source.threading, "Thread",
                        lambda target, **kw: type("T", (), {"start": target})())

    store_source.transfer_stored_source(uid)

    assert upload_state.read_state(uid)["expected_pages"] == 3
```

- [ ] **Step 2: Käivita test ja veendu, et see kukub**

Run: `.venv/bin/pytest tests/test_store_source.py -q -k valjajaetud_pilt`
Expected: FAIL — `assert 4 == 3` (kõik neli faili laaditi üles)

- [ ] **Step 3: Teosta**

`server/upload/store_source.py`, `_transfer_images_thread` — asenda `for` tsükkel:

```python
def _transfer_images_thread(upload_id: str, state: dict, directory: str) -> None:
    from ..config import OCR_SERVER_PATH
    from . import prepress_plan
    from .prepress_apply import publish_atomic

    slug = state["meta"]["slug"]
    # Vanem enne last: work-kaust elab staging-kausta all ja SFTP mkdir ei loo
    # vanemaid ise (vt prepress_apply._transfer_pages).
    remote_staging = "{}/{}".format(OCR_SERVER_PATH, state["remote_staging_path"])
    remote_work = "{}/{}".format(OCR_SERVER_PATH, state["remote_work_path"])

    plan = state.get("prepress")
    names = sorted(os.listdir(directory))
    # Väljajäetud leht ei tohi OCR-serverisse jõuda (viga B). enumerate annab
    # ülejäänutele uue järjenumbri — lehenumbrid nihkuvad ja see on õige:
    # imporditud teoses on täpselt need lehed, mis saadeti.
    kept = [name for i, name in enumerate(names, start=1)
            if not prepress_plan.is_excluded(plan, i)]

    def _run():
        sftp = None
        try:
            sftp = ocr_client.sftp_open(upload_id)
            ocr_client.ensure_remote_dirs(sftp, (remote_staging, remote_work))
            for i, name in enumerate(kept, start=1):
                publish_atomic(
                    sftp,
                    os.path.join(directory, name),
                    "{}/{}_pg_{:03d}.jpg".format(remote_work, slug, i),
                )
            # expected_pages PEAB tulema plaanist, mitte lähtefailist: muidu
            # ootab is_stalled lehti, mida ei tule, ja sammu 4 done-üleminek
            # jääb rippuma. Triviaalteel poolitusi ei ole, seega see arv on
            # sama mis prepress_plan.output_page_count(plan, len(names)).
            upload_state.set_upload_state(
                upload_id, status="processing", expected_pages=len(kept)
            )
        except Exception as e:
            logger.error("Piltide edastus {}: {}".format(upload_id, e))
            upload_state.set_upload_state(
                upload_id, status="error", error_message=str(e)
            )
        finally:
            if sftp:
                try:
                    sftp.close()
                except Exception:
                    pass

    upload_state.set_upload_state(upload_id, status="uploading")
    threading.Thread(
        target=_run, daemon=True, name="store-img-{}".format(upload_id)
    ).start()
```

- [ ] **Step 4: Käivita testid ja veendu, et need läbivad**

Run: `.venv/bin/pytest tests/test_store_source.py -q`
Expected: PASS (kõik, ka vanad)

- [ ] **Step 5: Commit**

```bash
git add server/upload/store_source.py tests/test_store_source.py
git commit -m "fix(upload): väljajätmine toimib ka pildikausta-teel (#255)"
```

### Task 2: Väljajätmine toimib PDF-teel + varutee rasterteele

Spekki tee (b): ehita PDF ilma väljajäetud lehtedeta (~36 s / 143 lk) selle
asemel, et kogu töö 300 DPI teele saata (~6 min). Poppler on Dockerfile'is
juba olemas (`poppler-utils`), uut Python-sõltuvust ei tule.

**Files:**
- Create: `server/upload/pdf_subset.py`
- Modify: `server/upload/store_source.py` (`_transfer_pdf_thread`), `server/upload/prepress_plan.py` (kommentaar)
- Test: `tests/test_pdf_subset.py` (uus), `tests/test_store_source.py`

**Interfaces:**
- Produces: `pdf_subset.build_subset_pdf(src_pdf: str, keep_pages: List[int], dst_pdf: str) -> int` — tagastab kirjutatud lehtede arvu; tõstab `RuntimeError`, kui poppler kukub
- Consumes: `prepress_apply.apply_and_transfer(upload_id)` (olemas) — varutee siht

- [ ] **Step 1: Kirjuta kukkuv test alamhulga-moodulile**

Loo `tests/test_pdf_subset.py`:

```python
"""PDF-i alamhulk poppleriga: väljajäetud lehed ei tohi väljundisse jõuda."""
import subprocess

import pytest
from PIL import Image

from server.upload import pdf_subset


def _make_pdf(path, page_count):
    """Pillow oskab mitmelehelist PDF-i — päris fail, mitte mock."""
    pages = [Image.new("RGB", (60, 80), "white") for _ in range(page_count)]
    pages[0].save(str(path), save_all=True, append_images=pages[1:])


def _page_count(path):
    out = subprocess.run(["pdfinfo", str(path)], stdout=subprocess.PIPE, check=True)
    for line in out.stdout.decode().splitlines():
        if line.startswith("Pages:"):
            return int(line.split()[1])
    raise AssertionError("pdfinfo ei andnud lehtede arvu")


def test_alamhulk_sisaldab_ainult_soovitud_lehti(tmp_path):
    src = tmp_path / "src.pdf"
    _make_pdf(src, 5)
    dst = tmp_path / "out.pdf"

    written = pdf_subset.build_subset_pdf(str(src), [1, 3, 5], str(dst))

    assert written == 3
    assert _page_count(dst) == 3


def test_koik_lehed_alles_annab_sama_arvu(tmp_path):
    src = tmp_path / "src.pdf"
    _make_pdf(src, 3)
    dst = tmp_path / "out.pdf"
    assert pdf_subset.build_subset_pdf(str(src), [1, 2, 3], str(dst)) == 3


def test_tuhi_valik_on_viga(tmp_path):
    src = tmp_path / "src.pdf"
    _make_pdf(src, 2)
    with pytest.raises(ValueError):
        pdf_subset.build_subset_pdf(str(src), [], str(tmp_path / "out.pdf"))


def test_vigane_pdf_annab_runtimeerrori(tmp_path):
    """Varutee päästik: kutsuja peab saama PÜÜTAVA erandi, mitte krahhi."""
    src = tmp_path / "katki.pdf"
    src.write_bytes(b"%PDF-1.4\nsee ei ole pdf\n")
    with pytest.raises(RuntimeError):
        pdf_subset.build_subset_pdf(str(src), [1], str(tmp_path / "out.pdf"))


def test_ajutine_kaust_koristatakse(tmp_path):
    src = tmp_path / "src.pdf"
    _make_pdf(src, 4)
    dst = tmp_path / "out.pdf"
    pdf_subset.build_subset_pdf(str(src), [2, 3], str(dst))
    # Ainult lähte- ja sihtfail; pdfseparate'i üksiklehed on kadunud.
    assert sorted(p.name for p in tmp_path.iterdir()) == ["out.pdf", "src.pdf"]
```

- [ ] **Step 2: Käivita test ja veendu, et see kukub**

Run: `.venv/bin/pytest tests/test_pdf_subset.py -q`
Expected: FAIL — `ModuleNotFoundError: server.upload.pdf_subset`

- [ ] **Step 3: Teosta `pdf_subset.py`**

Loo `server/upload/pdf_subset.py`:

```python
"""PDF-i alamhulga ehitamine poppleriga (pdfseparate + pdfunite).

Miks üldse PDF, kui OCR-server võtab ka üksikpilte vastu? Võtab — aga siis
peaksime lehed ise 300 DPI-l välja renderdama (~6 min / 143 lk). Alamhulga
ehitamine jätab rasterdamise OCR-serveri poolele, kus see niikuinii toimub:
~36 s sama töö kohta.

Sõltuvus: poppler-utils (Dockerfile'is olemas, sama pakett mis pdftoppm).
"""
import os
import shutil
import tempfile
from typing import List

from ..config import get_logger
from .page_source import nice_run

logger = get_logger(__name__)

SUBSET_TIMEOUT = 600      # 143 lk mahub ~36 s sisse; varu katab suuremad tööd


def build_subset_pdf(src_pdf: str, keep_pages: List[int], dst_pdf: str) -> int:
    """Kirjutab dst_pdf-i ainult keep_pages (1-põhised) lehed, samas järjekorras.

    Tagastab kirjutatud lehtede arvu. Tõstab RuntimeError, kui poppler kukub —
    kutsuja peab sellest tegema varutee-otsuse, mitte laskma erandil välja.
    """
    if not keep_pages:
        raise ValueError("keep_pages on tühi — kogu töö oleks väljajäetud")

    tmp_dir = tempfile.mkdtemp(prefix="pdfsubset-", dir=os.path.dirname(dst_pdf))
    try:
        # pdfseparate kirjutab %d-mustri järgi ühe faili lehe kohta.
        pattern = os.path.join(tmp_dir, "pg-%d.pdf")
        nice_run(["pdfseparate", src_pdf, pattern], timeout=SUBSET_TIMEOUT)

        parts = []
        for n in keep_pages:
            part = os.path.join(tmp_dir, "pg-{}.pdf".format(n))
            if not os.path.isfile(part):
                raise RuntimeError("pdfseparate ei loonud lehte {}".format(n))
            parts.append(part)

        out_tmp = os.path.join(tmp_dir, "united.pdf")
        nice_run(["pdfunite"] + parts + [out_tmp], timeout=SUBSET_TIMEOUT)
        shutil.move(out_tmp, dst_pdf)
        os.chmod(dst_pdf, 0o644)
        return len(parts)
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)
```

- [ ] **Step 4: Käivita test ja veendu, et see läbib**

Run: `.venv/bin/pytest tests/test_pdf_subset.py -q`
Expected: PASS (5 testi)

- [ ] **Step 5: Kirjuta kukkuv test edastusteele**

Lisa `tests/test_store_source.py` lõppu:

```python
def test_pdf_teel_ehitatakse_alamhulk_ilma_valjajaetud_lehtedeta(upload, monkeypatch):
    """Viga B, PDF-i haru: originaal läks muutmata edasi ja väljajätt oli no-op."""
    uid, base = upload
    from tests.test_pdf_subset import _make_pdf, _page_count
    _make_pdf(base / "source.pdf", 4)
    upload_state.init_prepress(uid, 4)
    upload_state.mutate_prepress(uid, lambda p: p["pages"][2].update(excluded=True))

    put = []

    class _Sftp:
        def put(self, src, dst):
            put.append((src, dst))
        def rename(self, a, b):
            pass
        def close(self):
            pass

    monkeypatch.setattr(store_source.ocr_client, "sftp_open", lambda i: _Sftp())
    monkeypatch.setattr(store_source.ocr_client, "ensure_remote_dirs",
                        lambda sftp, dirs: None)
    monkeypatch.setattr(store_source.threading, "Thread",
                        lambda target, **kw: type("T", (), {"start": target})())

    store_source.transfer_stored_source(uid)

    assert len(put) == 1
    assert _page_count(put[0][0]) == 3                       # saadeti alamhulk
    assert put[0][0] != str(base / "source.pdf")             # MITTE originaal
    assert upload_state.read_state(uid)["expected_pages"] == 3


def test_pdf_teel_ilma_valjajatmiseta_laheb_originaal(upload, monkeypatch):
    """Puutumata plaan peab endiselt käima kõige odavamat teed."""
    uid, base = upload
    from tests.test_pdf_subset import _make_pdf
    _make_pdf(base / "source.pdf", 3)
    upload_state.init_prepress(uid, 3)

    put = []

    class _Sftp:
        def put(self, src, dst):
            put.append(src)
        def rename(self, a, b):
            pass
        def close(self):
            pass

    monkeypatch.setattr(store_source.ocr_client, "sftp_open", lambda i: _Sftp())
    monkeypatch.setattr(store_source.ocr_client, "ensure_remote_dirs",
                        lambda sftp, dirs: None)
    monkeypatch.setattr(store_source.threading, "Thread",
                        lambda target, **kw: type("T", (), {"start": target})())

    store_source.transfer_stored_source(uid)

    assert put == [str(base / "source.pdf")]


def test_alamhulga_ebaonnestumine_langeb_rasterteele_ja_logib(upload, monkeypatch, caplog):
    """Kasutajat ei tüüdata; logi PEAB ütlema, miks töö läks kalli tee peale."""
    uid, base = upload
    from tests.test_pdf_subset import _make_pdf
    _make_pdf(base / "source.pdf", 3)
    upload_state.init_prepress(uid, 3)
    upload_state.mutate_prepress(uid, lambda p: p["pages"][0].update(excluded=True))

    def _kukub(*a, **kw):
        raise RuntimeError("pdfunite exit=1")

    monkeypatch.setattr(store_source.pdf_subset, "build_subset_pdf", _kukub)
    rastered = []
    monkeypatch.setattr(store_source.prepress_apply, "apply_and_transfer",
                        lambda i: rastered.append(i))
    monkeypatch.setattr(store_source.threading, "Thread",
                        lambda target, **kw: type("T", (), {"start": target})())

    with caplog.at_level("WARNING"):
        store_source.transfer_stored_source(uid)

    assert rastered == [uid]
    assert "falling back to raster path" in caplog.text
```

- [ ] **Step 6: Käivita test ja veendu, et see kukub**

Run: `.venv/bin/pytest tests/test_store_source.py -q -k alamhulk`
Expected: FAIL — saadeti originaalfail (`_page_count(...) == 4`)

- [ ] **Step 7: Teosta edastustee**

`server/upload/store_source.py` — lisa moodulitasemele
`from . import pdf_subset, prepress_apply, prepress_plan` (testid monkeypatch'ivad
neid mooduli atribuutidena) ja **eemalda Task 1-s lisatud funktsioonisisene
`from . import prepress_plan`**. Tsüklit ei teki: `prepress_apply` ei impordi
`store_source`-i. Seejärel asenda `_transfer_pdf_thread`:

```python
def _transfer_pdf_thread(upload_id: str, state: dict, pdf: str) -> None:
    from ..config import OCR_SERVER_PATH

    slug = state["meta"]["slug"]
    staging = "{}/{}".format(OCR_SERVER_PATH, state["remote_staging_path"])
    remote_tmp = "{}/{}.pdf.tmp".format(staging, slug)
    remote_dst = "{}/{}.pdf".format(staging, slug)

    plan = state.get("prepress")
    page_count = len((plan or {}).get("pages", []))
    keep = [n for n in range(1, page_count + 1)
            if not prepress_plan.is_excluded(plan, n)]
    needs_subset = page_count > 0 and len(keep) < page_count

    def _run():
        send_path, expected = pdf, None
        if needs_subset:
            try:
                subset = os.path.join(
                    upload_state.upload_dir(upload_id), "apply_tmp", "subset.pdf"
                )
                os.makedirs(os.path.dirname(subset), exist_ok=True)
                expected = pdf_subset.build_subset_pdf(pdf, keep, subset)
                send_path = subset
            except Exception as e:
                # Varutee (a): plaan läheb 300 DPI teele, kus page_cuts
                # väljajätmist juba arvestab. Kasutajat ei tüüdata — ainus
                # tagajärg on ooteaeg —, aga ilma selle logireata ei ole
                # hiljem võimalik aru saada, miks 143-leheline töö võttis
                # 36 sekundi asemel kuus minutit.
                logger.warning(
                    "exclusion-only PDF fast path failed; falling back to "
                    "raster path: upload=%s: %s", upload_id, e
                )
                # apply_and_transfer eeldab, et CAS on juba loa andnud —
                # try_begin_applying jooksis apply endpointis. Uut CAS-i ei
                # tohi teha: staatus on praegu "uploading", mitte
                # "awaiting_split", ja start_apply ütleks lihtsalt ei.
                prepress_apply.apply_and_transfer(upload_id)
                return

        sftp = None
        try:
            sftp = ocr_client.sftp_open(upload_id)
            ocr_client.ensure_remote_dirs(sftp, (staging,))
            sftp.put(send_path, remote_tmp)
            sftp.rename(remote_tmp, remote_dst)
            if expected is not None:
                upload_state.set_upload_state(
                    upload_id, status="processing", expected_pages=expected
                )
            else:
                upload_state.set_upload_state(upload_id, status="processing")
            logger.info("Lähte-PDF edastatud OCR-serverisse: {}".format(upload_id))
        except Exception as e:
            logger.error("PDF edastus {}: {}".format(upload_id, e))
            upload_state.set_upload_state(
                upload_id, status="error", error_message=str(e)
            )
        finally:
            if sftp:
                try:
                    sftp.close()
                except Exception:
                    pass

    upload_state.set_upload_state(upload_id, status="uploading")
    threading.Thread(
        target=_run, daemon=True, name="store-pdf-{}".format(upload_id)
    ).start()
```

- [ ] **Step 8: Uuenda `is_trivial_plan` kommentaari**

`server/upload/prepress_plan.py` — vana põhjendus („PDF-i ümberehitus maksab ~36 s ja ~800 MB, kallim kui eelvaade") ei kehti enam:

```python
def is_trivial_plan(plan: Optional[dict]) -> bool:
    """Kas plaan taandub PDF-teele (ükski leht ei poolitu).

    Väljajätmised EI mõjuta triviaalsust — nendega tegeleb edastustee ise
    (store_source: PDF-i alamhulk või piltide vahelejätmine). Triviaalne
    tähendab siin ainult „meie pool ei pea ühtki pikslit renderdama".
    """
```

- [ ] **Step 9: Käivita kõik testid**

Run: `.venv/bin/pytest tests/ -q`
Expected: PASS

- [ ] **Step 10: Commit ja PR A**

```bash
git add server/upload/pdf_subset.py server/upload/store_source.py \
        server/upload/prepress_plan.py tests/test_pdf_subset.py tests/test_store_source.py
git commit -m "fix(upload): väljajätmine toimib ka PDF-teel; varutee rasterteele (#255)"
git push -u origin fix/upload-valjajatmine-triviaalteel
gh pr create --base main --title "fix(upload): väljajätmine ei ole enam vaikne no-op (#255)"
```

---

# PR B — ülevaatuse ekraan

### Task 3: Vaikeplaan on `nosplit`; `enabled` kaob mõlemast otsast

Spekki viga A ja §2. **Backend ja frontend PEAVAD muutuma samas commitis:**
frontendi unustamine annab vaikse lahknevuse, kus UI ütleb „0 poolitatakse"
samal ajal, kui backend poolitab.

**Migratsioon:** olemasolevatel staging-upload'idel on plaanis `enabled: False`
ja iga leht `mode: "default"`. Kui `enabled` guard lihtsalt eemaldada, hakkab
`effective_split_x` neid kõiki 50% pealt poolitama. Seepärast tuleb legacy-plaan
lugemisel normaliseerida.

**Files:**
- Modify: `server/upload/prepress_plan.py`, `server/routers/upload.py`, `src/pages/upload/prepressPlan.ts`, `src/pages/upload/types.ts`, `src/pages/upload/uploadApi.ts`, `src/pages/upload/components/UploadStepSplit.tsx`
- Test: `tests/test_prepress_plan.py`, `tests/test_prepress_endpoints.py`, `src/pages/upload/__tests__/prepressPlan.test.ts`

**Interfaces:**
- Produces: `prepress_plan.normalize_legacy_plan(plan: dict) -> None` — muudab dikti KOHAPEAL (sobib `mutate_prepress` fn-iks), idempotentne
- Muutub: `PrepressPlan` (TS) ja plaani JSON kaotavad välja `enabled`

- [ ] **Step 1: Kirjuta kukkuvad backend-testid**

Lisa `tests/test_prepress_plan.py` lõppu:

```python
def test_vaikeplaan_ei_poolita_uhtki_lehte():
    """§2: default_split_x on üldjoone väärtus, mitte rakendatud joon."""
    plan = prepress_plan.default_plan(3)
    assert [p["mode"] for p in plan["pages"]] == ["nosplit"] * 3
    assert plan["default_split_x"] == 0.5
    assert "enabled" not in plan
    assert prepress_plan.output_page_count(plan, 3) == 3
    assert prepress_plan.is_trivial_plan(plan) is True


def test_poolita_koik_annab_default_moodi_lehed():
    plan = prepress_plan.default_plan(2)
    for page in plan["pages"]:
        page["mode"] = "default"
    assert prepress_plan.effective_split_x(plan, 1) == 0.5
    assert prepress_plan.output_page_count(plan, 2) == 4
    assert prepress_plan.is_trivial_plan(plan) is False


def test_legacy_plaan_enabled_false_ei_hakka_poolitama():
    """MIGRATSIOON: staging'us olevad plaanid kannavad veel vana kuju."""
    legacy = {
        "enabled": False,
        "default_split_x": 0.5,
        "preview_status": "ready",
        "preview_done": 3,
        "pages": [
            {"n": 1, "mode": "default", "split_x": None, "excluded": False},
            {"n": 2, "mode": "custom", "split_x": 0.4, "excluded": False},
            {"n": 3, "mode": "nosplit", "split_x": None, "excluded": True},
        ],
    }
    prepress_plan.normalize_legacy_plan(legacy)

    assert "enabled" not in legacy
    assert legacy["pages"][0]["mode"] == "nosplit"      # default → nosplit
    assert legacy["pages"][1]["mode"] == "custom"       # käsitsi töö jääb
    assert legacy["pages"][1]["split_x"] == 0.4
    assert legacy["pages"][2]["excluded"] is True


def test_legacy_plaan_enabled_true_sailitab_poolituse():
    legacy = {
        "enabled": True,
        "default_split_x": 0.5,
        "pages": [{"n": 1, "mode": "default", "split_x": None, "excluded": False}],
    }
    prepress_plan.normalize_legacy_plan(legacy)
    assert "enabled" not in legacy
    assert legacy["pages"][0]["mode"] == "default"      # jäi poolituma


def test_normaliseerimine_on_idempotentne():
    plan = prepress_plan.default_plan(2)
    prepress_plan.normalize_legacy_plan(plan)
    prepress_plan.normalize_legacy_plan(plan)
    assert [p["mode"] for p in plan["pages"]] == ["nosplit", "nosplit"]
```

- [ ] **Step 2: Käivita testid ja veendu, et need kukuvad**

Run: `.venv/bin/pytest tests/test_prepress_plan.py -q -k "vaikeplaan or legacy or idempot"`
Expected: FAIL — `assert ['default', ...] == ['nosplit', ...]` ja `AttributeError: normalize_legacy_plan`

- [ ] **Step 3: Teosta backend**

`server/upload/prepress_plan.py`:

```python
def default_plan(page_count: int) -> dict:
    """Uue uploadi vaikeplaan: ükski leht ei poolitu.

    default_split_x on üldjoone VÄÄRTUS, mitte rakendatud joon — ta hakkab
    kehtima alles siis, kui kasutaja vajutab „Poolita kõik" ja lehed saavad
    mode: "default". Poolitamine on destruktiivne teisendus ja seda ei tohi
    saada kogemata 'Edasi' vajutusega (§2, viga A).
    """
    return {
        "default_split_x": 0.5,
        "preview_status": "idle",
        "preview_done": 0,
        "pages": [
            {"n": n, "mode": "nosplit", "split_x": None, "excluded": False}
            for n in range(1, page_count + 1)
        ],
    }


def normalize_legacy_plan(plan: dict) -> None:
    """Viib vana kujuga plaani (`enabled`) uude semantikasse. KOHAPEAL.

    Vana mudelis tähendas `mode: "default"` + `enabled: False` „ei poolita".
    Uues mudelis tähendaks sama kirje „poolita üldjoonelt" — st ilma selle
    teisenduseta hakkaks pooleliolev upload äkki kõiki lehti poolitama.
    Idempotentne: võtme puudumisel ei tee midagi.
    """
    if "enabled" not in plan:
        return
    if not plan.pop("enabled"):
        for entry in plan.get("pages", []):
            if entry.get("mode") == "default":
                entry["mode"] = "nosplit"
```

Samas failis: `effective_split_x` ja `is_trivial_plan` kaotavad `enabled` kontrolli.

```python
def effective_split_x(plan: Optional[dict], n: int) -> Optional[float]:
    """Kas ja kus leht n poolitatakse. None = ei poolitata.

    custom väärtused jäävad plaani alles ka siis, kui leht on väljundist väljas
    — `excluded` domineerib väljundi koostamisel, aga ei kustuta poolitusolekut
    (§11).
    """
    entry = _page_entry(plan, n)
    if entry is None:
        return None
    mode = entry.get("mode", "nosplit")
    if mode == "nosplit":
        return None
    if mode == "custom":
        x = entry.get("split_x")
        return float(x) if x is not None else None
    return float((plan or {}).get("default_split_x", 0.5))


def is_trivial_plan(plan: Optional[dict]) -> bool:
    """Kas plaan taandub PDF-teele (ükski leht ei poolitu). (Docstring Task 2-st.)"""
    if not plan:
        return True
    return all(
        effective_split_x(plan, entry.get("n")) is None
        for entry in plan.get("pages", [])
    )
```

Uuenda ka mooduli päise plaani-näidis (`"enabled": False` rida kaob, `mode` vaikeväärtus on `"nosplit"`).

- [ ] **Step 4: Ühenda normaliseerimine endpointidesse**

`server/routers/upload.py`, `_load_prepress` — üks chokepoint kõigi prepress-teede jaoks (GET, save, start, apply):

```python
def _load_prepress(upload_id: str) -> tuple:
    """Ühine eeltöö: valideeri upload_id, loe state ja plaan.

    Normaliseerib vana kujuga plaani (`enabled`) ja KIRJUTAB tulemuse tagasi —
    muidu näeks apply endiselt legacy-kuju ja poolitaks kõik lehed (Task 3).
    """
    if not _valid_upload_id(upload_id):
        raise HTTPException(status_code=400, detail="Vigane upload_id")
    state = upload_state.read_state(upload_id)
    if not state:
        raise HTTPException(status_code=404, detail="Uploadi ei leitud")
    plan = state.get("prepress")
    if plan is not None and "enabled" in plan:
        plan = upload_state.mutate_prepress(
            upload_id, prepress_plan.normalize_legacy_plan
        )
    return state, plan
```

Sama failis `admin_prepress_start`: kustuta rida
`upload_state.mutate_prepress(upload_id, lambda p: p.update(enabled=True))`.

Sama failis `admin_prepress_save`: kustuta `enabled = bool(data.get("enabled"))`
ja `plan["enabled"] = enabled` rida `_apply`-st. Lubatud `mode` väärtused jäävad
samaks (`default`, `custom`, `nosplit`).

- [ ] **Step 5: Käivita backend-testid**

Run: `.venv/bin/pytest tests/ -q`
Expected: PASS. **Kukub** vana `test_store_source.py` väide
`state["prepress"]["enabled"] is False` — asenda see reaga
`assert all(p["mode"] == "nosplit" for p in state["prepress"]["pages"])`.
Sama kontrolli teistes prepress-testides (`grep -rn '"enabled"' tests/`).

- [ ] **Step 6: Kirjuta kukkuvad frontend-testid**

`src/pages/upload/__tests__/prepressPlan.test.ts` — failis on juba abifunktsioon
`plan(overrides: Partial<PrepressPlan>)`. Eemalda sellest rida `enabled: true,`
ja lisa kaks testi:

```ts
it('vaikeplaani lehed ei poolitu', () => {
  const p = plan({
    page_count: 2,
    pages: [
      { n: 1, mode: 'nosplit', split_x: null, excluded: false },
      { n: 2, mode: 'nosplit', split_x: null, excluded: false },
    ],
  });
  expect(willSplit(p, 1)).toBe(false);
  expect(countOutputPages(p)).toBe(2);
  expect(summarizePlan(p).split).toBe(0);
});

it('default-moodis leht poolitub ilma igasuguse lülitita', () => {
  const p = plan({
    page_count: 1,
    pages: [{ n: 1, mode: 'default', split_x: null, excluded: false }],
  });
  expect(willSplit(p, 1)).toBe(true);
  expect(countOutputPages(p)).toBe(2);
});
```

**NB:** `enabled: true` eemaldamine muudab olemasolevate testide ootusi —
`plan()` vaikefixture'i lk 1 on `mode: 'default'` ehk poolitub endiselt. Käi
failis olevad `expect`-id üle ja paranda need, mis lugesid `enabled`-i mõju.

- [ ] **Step 7: Käivita frontend-testid ja veendu, et need kukuvad**

Run: `npm test -- prepressPlan`
Expected: FAIL — TS-viga puuduva `enabled` välja pärast

- [ ] **Step 8: Teosta frontend**

`src/pages/upload/types.ts` — `PrepressPlan`-ist kaob `enabled: boolean;`.

`src/pages/upload/prepressPlan.ts` — kolm funktsiooni kaotavad `plan.enabled` kontrolli:

```ts
/** Kokkuvõtteriba arvud. Puhas — komponent ainult vormindab.
 *  „poolitatakse N" loeb AINULT OCR-i minevaid poolitatud lehti (§11). */
export function summarizePlan(plan: PrepressPlan): PlanSummary {
  return {
    split: plan.pages.filter((p) => !p.excluded && p.mode !== 'nosplit').length,
    excluded: plan.pages.filter((p) => p.excluded).length,
    output: countOutputPages(plan),
  };
}

export function countOutputPages(plan: PrepressPlan): number {
  return plan.pages.reduce((total, page) => {
    if (page.excluded) return total;
    if (page.mode === 'nosplit') return total + 1;
    if (page.mode === 'custom' && page.split_x == null) return total + 1;
    return total + 2;
  }, 0);
}

export function willSplit(plan: PrepressPlan, n: number): boolean {
  const page = plan.pages.find((p) => p.n === n);
  if (!page || page.excluded) return false;
  if (page.mode === 'nosplit') return false;
  if (page.mode === 'custom' && page.split_x == null) return false;
  return true;
}
```

`src/pages/upload/uploadApi.ts` — `savePrepress` teine parameeter:
`Pick<PrepressPlan, 'default_split_x' | 'pages'>`.

`src/pages/upload/components/UploadStepSplit.tsx` — asenda kõik `plan.enabled`
kasutused: `persist` saadab ainult `{ default_split_x, pages }`, `handleContinue`
salvestab tingimusteta, `handleOptIn` kaob koos kastikesega (kastike ise kaob
Task 9-s; siin piisab sellest, et `enabled` ei ole enam olemas — tee lülitist
ajutiselt `startPrepress` kutsuv nupp, mille Task 9 asendab).

- [ ] **Step 9: Käivita väravad**

```bash
npm test && npm run typecheck && npm run lint:ci && .venv/bin/pytest tests/ -q
```
Expected: kõik PASS

- [ ] **Step 10: Commit**

```bash
git add server/upload/prepress_plan.py server/routers/upload.py tests/ \
        src/pages/upload/
git commit -m "feat(upload): vaikeplaan ei poolita; enabled kaob mõlemast otsast (#255)"
```

### Task 4: `preview_cancel` — apply ei oota eelvaadet, vaid katkestab selle

**Files:**
- Modify: `server/upload/prepress_plan.py`, `server/upload/prepress.py`, `server/upload/state.py`, `server/routers/upload.py`, `src/pages/upload/types.ts`
- Test: `tests/test_prepress_lifecycle.py`

**Interfaces:**
- Consumes: `prepress_plan.default_plan` (Task 3)
- Produces: plaani väli `preview_cancel: bool`; `preview_status` uus väärtus `"cancelled"`; `APPLY_START_STATUSES` sisaldab `"prepping"`

- [ ] **Step 1: Kirjuta kukkuvad testid**

Lisa `tests/test_prepress_lifecycle.py` lõppu:

```python
def test_apply_tohib_alata_renderduse_ajalt(prepress_upload):
    """500-lehelisel tööl ei tohi „Edasi" olla ~5 min surnud."""
    uid = prepress_upload
    upload_state.set_upload_state(uid, status="prepping")
    assert upload_state.try_begin_applying(uid) is True
    assert upload_state.read_state(uid)["status"] == "applying"


def test_apply_seab_katkestuslipu_sama_luku_all(prepress_upload):
    uid = prepress_upload
    upload_state.set_upload_state(uid, status="prepping")
    upload_state.try_begin_applying(uid)
    assert upload_state.read_state(uid)["prepress"]["preview_cancel"] is True


def test_renderdaja_valjub_lipu_peale(prepress_upload, monkeypatch):
    """Lippu kontrollitakse IGA lehe alguses, mitte partii lõpus."""
    uid = prepress_upload
    renderdatud = []

    class _Source:
        def page_count(self):
            return 5
        def render_preview(self, n, dst):
            renderdatud.append(n)
            open(dst, "wb").close()
            if n == 2:
                upload_state.mutate_prepress(uid, lambda p: p.update(preview_cancel=True))

    monkeypatch.setattr(prepress.page_source, "open_page_source", lambda p: _Source())
    monkeypatch.setattr(prepress, "source_path", lambda i: "/ei/loe")

    prepress._render_previews(uid)

    assert renderdatud == [1, 2]                     # 3. lehte ei alustatud
    plan = upload_state.read_state(uid)["prepress"]
    assert plan["preview_status"] == "cancelled"


def test_katkestatud_renderdaja_ei_kirjuta_apply_staatust_ule(prepress_upload, monkeypatch):
    """Renderdaja EI TOHI applying'ut awaiting_split'iks tagasi lükata."""
    uid = prepress_upload

    class _Source:
        def page_count(self):
            return 2
        def render_preview(self, n, dst):
            open(dst, "wb").close()
            upload_state.set_upload_state(uid, status="applying")
            upload_state.mutate_prepress(uid, lambda p: p.update(preview_cancel=True))

    monkeypatch.setattr(prepress.page_source, "open_page_source", lambda p: _Source())
    monkeypatch.setattr(prepress, "source_path", lambda i: "/ei/loe")

    prepress._render_previews(uid)

    assert upload_state.read_state(uid)["status"] == "applying"


def test_start_nullib_katkestuslipu(prepress_upload, monkeypatch):
    """Ilma selleta läheb taaskäivitatud eelvaade kohe cancelled'iks."""
    uid = prepress_upload
    upload_state.mutate_prepress(uid, lambda p: p.update(
        preview_cancel=True, preview_status="cancelled"))
    monkeypatch.setattr(prepress.threading, "Thread",
                        lambda target, **kw: type("T", (), {"start": lambda s: None})())

    prepress.start_preview(uid)

    plan = upload_state.read_state(uid)["prepress"]
    assert plan["preview_cancel"] is False
    assert plan["preview_status"] == "rendering"
```

Kui `prepress_upload` fixture'it failis ei ole, tee see `test_prepress_endpoints.py`
`client_admin` eeskujul: `tmp_path` + `monkeypatch.setattr(upload_state, "upload_dir", ...)`
+ `write_state(status="awaiting_split")` + `init_prepress(uid, 5)`.

- [ ] **Step 2: Käivita testid ja veendu, et need kukuvad**

Run: `.venv/bin/pytest tests/test_prepress_lifecycle.py -q -k "katkest or apply_tohib or start_nullib"`
Expected: FAIL — `try_begin_applying` tagastab False (prepping ei ole lubatud)

- [ ] **Step 3: Teosta `state.py`**

```python
# Staatused, millest tohib alustada (uut) edastust OCR-serverisse.
# "error" on kaasas tahtlikult: lähtefail on endiselt VUTT-i poolel (koristus
# käib alles impordil), seega ebaõnnestunud partiid peab saama uuesti proovida.
# "prepping" on kaasas, sest ülevaatus on nüüd ALATI nähtav ja eelvaade jookseb
# iga upload'i puhul — ilma selleta oleks „Edasi" 500-lehelisel tööl ~5 minutit
# surnud. Apply katkestab eelvaate (preview_cancel), ei oota seda.
APPLY_START_STATUSES = ("awaiting_split", "prepping", "error")


def try_begin_applying(upload_id: str) -> bool:
    """CAS: awaiting_split | prepping | error → applying. False, kui töö juba käib.

    Seab ka preview_cancel lipu — SAMA luku sees ja OTSE dikti, mitte
    mutate_prepress kaudu: get_upload_lock on tavaline threading.Lock, mitte
    RLock, seega pesastatud kutse annaks ummikseisu.
    """
    lock = get_upload_lock(upload_id)
    with lock:
        s = read_state(upload_id)
        if not s or s.get("status") not in APPLY_START_STATUSES:
            return False
        s["status"] = "applying"
        if isinstance(s.get("prepress"), dict):
            s["prepress"]["preview_cancel"] = True
        write_state(upload_id, s)
        return True
```

- [ ] **Step 4: Teosta `prepress_plan.default_plan` ja `prepress.py`**

`default_plan` dikti lisandub `"preview_cancel": False` (kohe `preview_done` järele).

`server/upload/prepress.py`, `_render_previews` — lipu kontroll tsükli alguses ja
staatuse-valve lõpus:

```python
        for n in range(1, count + 1):
            # Lippu kontrollitakse IGA lehe alguses: apply ja eelvaade jagavad
            # sama RENDER_SEMAPHORE(1)-i, seega katkestamata renderdus põimuks
            # apply'ga lehe kaupa ja ligi kahekordistaks selle aja.
            plan = (upload_state.read_state(upload_id) or {}).get("prepress") or {}
            if plan.get("preview_cancel"):
                upload_state.mutate_prepress(
                    upload_id, lambda p: p.update(preview_status="cancelled")
                )
                logger.info("Prepress eelvaade katkestatud: {}".format(upload_id))
                return
            dst = preview_path(upload_id, n)
            ...
```

Lisaks: `_render_previews` lõpus ja `except`-harus EI TOHI staatust pimesi
`awaiting_split`-iks lükata — apply võib juba joosta:

```python
def _reset_status_if_prepping(upload_id: str) -> None:
    """Renderdaja tohib staatust lähtestada AINULT siis, kui ta on selle omanik.

    Pärast preview_cancel-i on staatus "applying" ja selle ülekirjutamine
    awaiting_split'iks lubaks teise apply CAS-i sisse (topelt-SFTP).
    """
    s = upload_state.read_state(upload_id)
    if s and s.get("status") == "prepping":
        upload_state.set_upload_state(upload_id, status="awaiting_split")
```

Kutsu seda mõlemas kohas, kus praegu on
`upload_state.set_upload_state(upload_id, status="awaiting_split")`.

`start_preview` — lisa lipu nullimine samasse luku-plokki:

```python
        s["status"] = "prepping"
        plan["preview_status"] = "rendering"
        plan["preview_cancel"] = False   # ühe tsükli lipp, mitte püsiv olek
        plan["preview_done"] = 0
        s["prepress"] = plan
        upload_state.write_state(upload_id, s)
```

- [ ] **Step 5: Käivita testid**

Run: `.venv/bin/pytest tests/ -q`
Expected: PASS

- [ ] **Step 6: Frontendi tüüp**

`src/pages/upload/types.ts`:

```ts
export type PreviewStatus = 'idle' | 'rendering' | 'ready' | 'error' | 'cancelled';

export interface PrepressPlan {
  default_split_x: number;
  preview_status: PreviewStatus;
  preview_done: number;
  preview_cancel: boolean;
  pages: PrepressPage[];
  page_count: number;
  output_page_count: number;
  trivial: boolean;
  status: string;
  ocr_model: 'print' | 'hand';   // lisandub Task 5-s
}
```

(`ocr_model` lisa alles Task 5-s, et typecheck ei kukuks — siin ainult
`preview_cancel` ja `'cancelled'`.)

- [ ] **Step 7: Väravad ja commit**

```bash
npm run typecheck && .venv/bin/pytest tests/ -q
git add server/upload/ server/routers/upload.py src/pages/upload/types.ts tests/
git commit -m "feat(upload): apply katkestab eelvaate; preview_cancel on ühe tsükli lipp (#255)"
```

### Task 5: OCR-mudel saab oma state-välja ja endpointi

**NB — asendab** `feat/upload-ocr-katkestamine` plaani Task 7 (see muutis
`meta.type`-i ja jättis kaugteed run-isolatsiooni hooleks). Uus spekk ütleb:
`meta.type` on bibliograafiline väide ja jääb puutumata; kaugteed arvutatakse
kohe ümber.

**Files:**
- Modify: `server/upload_ops.py`, `server/upload/state.py`, `server/routers/upload.py`, `src/pages/upload/types.ts`, `src/pages/upload/uploadApi.ts`
- Test: `tests/test_upload_ocr_model.py` (uus)

**Interfaces:**
- Produces:
  - `upload_ops.remote_paths(ocr_model: str, upload_id: str, slug: str) -> tuple` — `(staging, work)`
  - `upload_state.try_set_ocr_model(upload_id: str, model: str) -> bool`
  - `POST /admin/upload/{upload_id}/ocr-model`, keha `{"model": "print"|"hand"}`
  - `setOcrModel(uploadId, model, token)` (`uploadApi.ts`)

- [ ] **Step 1: Kirjuta kukkuv test**

Loo `tests/test_upload_ocr_model.py`:

```python
"""OCR-mudel on töötlusotsus, mitte bibliograafiline väide (spekk §3)."""
import threading

import pytest

from server.upload import state as upload_state


@pytest.fixture
def upload(tmp_path, monkeypatch):
    uid = "u1"
    base = tmp_path / uid
    base.mkdir()
    monkeypatch.setattr(upload_state, "upload_dir", lambda i: str(base))
    upload_state.write_state(uid, {
        "id": uid, "status": "awaiting_split",
        "ocr_model": "print",
        "meta": {"slug": "kirik-abc", "type": {"id": "Q1261026", "label": "trükis"}},
        "remote_staging_path": "AUTO-OCR/print/u1",
        "remote_work_path": "AUTO-OCR/print/u1/kirik-abc",
    })
    return uid


def test_vahetus_muudab_molemad_kaugteed(upload):
    assert upload_state.try_set_ocr_model(upload, "hand") is True
    s = upload_state.read_state(upload)
    assert s["ocr_model"] == "hand"
    assert s["remote_staging_path"] == "AUTO-OCR/hand/u1"
    assert s["remote_work_path"] == "AUTO-OCR/hand/u1/kirik-abc"


def test_vahetus_EI_PUUDU_meta_tyupi(upload):
    """Vaikne tüübimuutus jõuaks impordiga _metadata.json-i ja sealt Meilisse."""
    upload_state.try_set_ocr_model(upload, "hand")
    assert upload_state.read_state(upload)["meta"]["type"]["id"] == "Q1261026"


def test_vahetus_on_lubatud_ka_eelvaate_ajal(upload):
    upload_state.set_upload_state(upload, status="prepping")
    assert upload_state.try_set_ocr_model(upload, "hand") is True


@pytest.mark.parametrize("status", ["applying", "uploading", "processing",
                                    "reviewing", "imported"])
def test_vahetus_pole_lubatud_parast_apply_algust(upload, status):
    """Mudelit tohib muuta, kuni ükski OCR-input fail ei ole kaugserveris."""
    upload_state.set_upload_state(upload, status=status)
    assert upload_state.try_set_ocr_model(upload, "hand") is False


def test_tundmatu_mudel_ei_muuda_midagi(upload):
    assert upload_state.try_set_ocr_model(upload, "kuutõbi") is False
    assert upload_state.read_state(upload)["ocr_model"] == "print"


def test_apply_ja_vahetus_ei_saa_moelmad_voita(upload):
    """TOCTOU: kaugteed ei tohi muutuda töötava ülekande alt."""
    tulemused = []
    start = threading.Barrier(2)

    def vaheta():
        start.wait()
        tulemused.append(("model", upload_state.try_set_ocr_model(upload, "hand")))

    def rakenda():
        start.wait()
        tulemused.append(("apply", upload_state.try_begin_applying(upload)))

    t1, t2 = threading.Thread(target=vaheta), threading.Thread(target=rakenda)
    t1.start(); t2.start(); t1.join(); t2.join()

    s = upload_state.read_state(upload)
    if dict(tulemused).get("apply"):
        # Apply võitis → mudel EI TOHI olla pärast seda muutunud.
        assert s["ocr_model"] == "print" or not dict(tulemused).get("model")
    assert any(ok for _, ok in tulemused)
```

- [ ] **Step 2: Käivita test ja veendu, et see kukub**

Run: `.venv/bin/pytest tests/test_upload_ocr_model.py -q`
Expected: FAIL — `AttributeError: module 'server.upload.state' has no attribute 'try_set_ocr_model'`

- [ ] **Step 3: Teosta jagatud teevalem**

`server/upload_ops.py` — üks valem kahe kirjutaja jaoks:

```python
def remote_paths(ocr_model: str, upload_id: str, slug: str) -> tuple:
    """OCR-serveri staging- ja work-tee. ÜKS valem: create_upload ja
    mudelivahetus peavad andma sama vastuse."""
    staging = f"AUTO-OCR/{ocr_model}/{upload_id}"
    return staging, f"{staging}/{slug}"
```

`create_upload` kasutab seda:

```python
    ocr_model = 'hand' if work_type.get('id') == 'Q87167' else 'print'
    staging_path, work_path = remote_paths(ocr_model, upload_id, slug)
```

ja state dikti:

```python
        # Töötlusotsus, mitte bibliograafiline väide — vaikeväärtus tuletatakse
        # tüübist, aga edaspidi elab ta oma väljas ja meta.type ei muutu (§3).
        "ocr_model": ocr_model,
        "remote_staging_path": staging_path,
        "remote_work_path": work_path,
```

- [ ] **Step 4: Teosta CAS**

`server/upload/state.py`:

```python
# Mudelit tohib muuta seni, kuni ükski OCR-input fail ei ole kaugserverisse
# saadetud. Eelvaade elab ainult VUTT-i poolel, seega "prepping" on lubatud.
MODEL_CHANGE_STATUSES = ("awaiting_split", "prepping", "error")
OCR_MODELS = ("print", "hand")


def try_set_ocr_model(upload_id: str, model: str) -> bool:
    """CAS: staatusekontroll + ocr_model + MÕLEMAD kaugteed ÜHE luku all.

    Kaks eraldi luku-akent („kontrolli, siis kirjuta") laseks apply vahele:
    kontroll näeks awaiting_split'i, apply asuks tööle ja kaugteed
    kirjutataks ümber juba lennus oleva saatmise alt.
    """
    from ..upload_ops import remote_paths

    if model not in OCR_MODELS:
        return False
    lock = get_upload_lock(upload_id)
    with lock:
        s = read_state(upload_id)
        if not s or s.get("status") not in MODEL_CHANGE_STATUSES:
            return False
        slug = (s.get("meta") or {}).get("slug", "")
        staging, work = remote_paths(model, upload_id, slug)
        s["ocr_model"] = model
        s["remote_staging_path"] = staging
        s["remote_work_path"] = work
        write_state(upload_id, s)
        return True
```

(Import funktsiooni sees — `upload_ops` impordib `state`-i, mooduli tasemel
tekiks tsükkel.)

- [ ] **Step 5: Teosta endpoint**

`server/routers/upload.py`, prepress-ploki lõppu:

```python
@router.post("/admin/upload/{upload_id}/ocr-model")
async def admin_set_ocr_model(upload_id: str, request: Request,
                              user=Depends(require_role("admin"))):
    """Vahetab OCR-mudelit. EI muuda meta.type-i — see on bibliograafiline väli.

    Miks mitte PATCH /meta: update_upload_meta allow-list viskab tundmatu välja
    vaikselt ära ja tagastab ikka 200 (nii jäid varem salvestumata external_url
    ja ester_id), ning mudel ei ole ka meta väli.
    """
    data = await get_json_data(request)
    model = data.get("model")
    if model not in upload_state.OCR_MODELS:
        raise HTTPException(status_code=400, detail="Vigane mudel")
    _load_prepress(upload_id)
    ok = await run_in_threadpool(upload_state.try_set_ocr_model, upload_id, model)
    if not ok:
        return JSONResponse(
            status_code=409,
            content={"detail": "Mudelit saab muuta ainult enne OCR-i saatmist"},
        )
    return {"status": "saved", "ocr_model": model}
```

`admin_prepress_get` tagastab mudeli, et UI teaks, kumb kehtib:

```python
    result["ocr_model"] = state.get("ocr_model", "print")
```

- [ ] **Step 6: Käivita testid**

Run: `.venv/bin/pytest tests/ -q`
Expected: PASS. Kontrolli ka, et `test_prepress_endpoints.py`
rollikontrolli-test katab uue tee (`"ocr-model" in r.path` — vajadusel laienda
filtrit, sest nginx proksib `/api/files/` kaudu KÕIK backend-teed avalikult).

- [ ] **Step 7: Frontendi klient**

`src/pages/upload/types.ts` — `PrepressPlan`-i lisandub `ocr_model: 'print' | 'hand';`

`src/pages/upload/uploadApi.ts`:

```ts
export function setOcrModel(
  uploadId: string,
  model: 'print' | 'hand',
  token: string | null,
): Promise<{ status: string; ocr_model: string }> {
  return apiPost(`/admin/upload/${uploadId}/ocr-model`, { model }, { token });
}
```

- [ ] **Step 8: Väravad ja commit**

```bash
npm run typecheck && .venv/bin/pytest tests/ -q
git add server/ src/pages/upload/ tests/test_upload_ocr_model.py
git commit -m "feat(upload): OCR-mudel omas state-väljas; vahetus ühe CAS-i all (#255)"
```

- [ ] **Step 9: Märgi vana plaan asendatuks**

```bash
git show feat/upload-ocr-katkestamine:docs/superpowers/plans/2026-08-08-upload-ocr-katkestamine.md > /tmp/vana.md
```
Lisa selle haru plaani Task 7 pealkirja alla üks rida (eraldi commit sinna harusse,
kui haru veel elab): **„ASENDATUD 2026-08-25 plaani Task 5-ga — `meta.type` jääb
puutumata ja kaugteed arvutatakse vahetuse hetkel ümber."** Kui haru enam ei
kasutata, piisab märkest ADR-is (Task 11).

### Task 6: Hulgioperatsioonid `prepressPlan.ts`-is

**Kogu ülevaatuse otsustusloogika elab siin** — komponendid jäävad
vormindajateks. See on ainus koht, kus frontendi loogikat saab päriselt
testida (vt Global Constraints).

**Files:**
- Modify: `src/pages/upload/prepressPlan.ts`
- Test: `src/pages/upload/__tests__/prepressPlan.test.ts`

**Interfaces:**
- Produces (kõik puhtad, tagastavad UUE plaani):
  - `applyDefaultSplitTo(plan: PrepressPlan, ns?: number[]): PrepressPlan` — `nosplit` → `default`; `custom` jääb puutumata
  - `clearDefaultSplit(plan: PrepressPlan): PrepressPlan` — `default` → `nosplit`; `custom` jääb puutumata
  - `setNoSplit(plan: PrepressPlan, ns: number[]): PrepressPlan` — valitud lehed → `nosplit`, KA `custom`
  - `setExcluded(plan: PrepressPlan, ns: number[], excluded: boolean): PrepressPlan`
  - `countByMode(plan: PrepressPlan, ns: number[]): { applied: number; keptCustom: number }` — tegevusriba teate arvud

- [ ] **Step 1: Kirjuta kukkuvad testid**

Lisa `src/pages/upload/__tests__/prepressPlan.test.ts`-i:

```ts
// Testifailis on juba abifunktsioon `plan(overrides)` — kasuta seda, ära tee uut.
const mixed = () => plan({
  page_count: 4,
  pages: [
    { n: 1, mode: 'nosplit', split_x: null, excluded: false },
    { n: 2, mode: 'custom', split_x: 0.42, excluded: false },
    { n: 3, mode: 'nosplit', split_x: null, excluded: true },
    { n: 4, mode: 'default', split_x: null, excluded: false },
  ],
});

describe('applyDefaultSplitTo', () => {
  it('viib nosplit-lehed default-i ega puutu custom-i (§7)', () => {
    const next = applyDefaultSplitTo(mixed());
    expect(next.pages.map((p) => p.mode)).toEqual(['default', 'custom', 'default', 'default']);
    expect(next.pages[1].split_x).toBe(0.42);
  });

  it('valikuga puudutab ainult nimetatud lehti', () => {
    const next = applyDefaultSplitTo(mixed(), [1]);
    expect(next.pages.map((p) => p.mode)).toEqual(['default', 'custom', 'nosplit', 'default']);
  });

  it('ei muuda algset plaani', () => {
    const plan = mixed();
    applyDefaultSplitTo(plan);
    expect(plan.pages[0].mode).toBe('nosplit');
  });
});

describe('clearDefaultSplit', () => {
  it('võtab maha ainult üldjoone; käsitsi seatu jääb (§2)', () => {
    const next = clearDefaultSplit(mixed());
    expect(next.pages.map((p) => p.mode)).toEqual(['nosplit', 'custom', 'nosplit', 'nosplit']);
    expect(next.pages[1].split_x).toBe(0.42);
  });
});

describe('setNoSplit', () => {
  it('valikul on otsene: puudutab ka custom-lehti (§7)', () => {
    const next = setNoSplit(mixed(), [2, 4]);
    expect(next.pages.map((p) => p.mode)).toEqual(['nosplit', 'nosplit', 'nosplit', 'nosplit']);
    expect(next.pages[1].split_x).toBeNull();
  });
});

describe('setExcluded', () => {
  it('EI kustuta poolitusolekut (§11 invariant)', () => {
    const out = setExcluded(mixed(), [2], true);
    expect(out.pages[1].excluded).toBe(true);
    expect(out.pages[1].mode).toBe('custom');
    expect(out.pages[1].split_x).toBe(0.42);

    const back = setExcluded(out, [2], false);
    expect(back.pages[1].mode).toBe('custom');
    expect(back.pages[1].split_x).toBe(0.42);
  });

  it('väljajäetud leht ei loe kokkuvõttes (§11)', () => {
    const plan = setExcluded(applyDefaultSplitTo(mixed()), [1], true);
    // lk 1 väljas; lk 2 custom 2 lehte; lk 3 default 2; lk 4 default 2
    expect(countOutputPages(plan)).toBe(6);
    expect(summarizePlan(plan).split).toBe(3);   // väljajäetut EI loeta
    expect(summarizePlan(plan).excluded).toBe(2);
  });
});

describe('countByMode', () => {
  it('annab tegevusriba teate arvud', () => {
    expect(countByMode(mixed(), [1, 2, 3, 4])).toEqual({ applied: 3, keptCustom: 1 });
  });
});
```

- [ ] **Step 2: Käivita testid ja veendu, et need kukuvad**

Run: `npm test -- prepressPlan`
Expected: FAIL — `applyDefaultSplitTo is not a function`

- [ ] **Step 3: Teosta**

`src/pages/upload/prepressPlan.ts` lõppu:

```ts
/** Muudab valitud (või kõik) lehed uue kirje järgi. Puhas: uus plaan, uued lehed. */
function mapPages(
  plan: PrepressPlan,
  ns: number[] | undefined,
  fn: (page: PrepressPage) => PrepressPage,
): PrepressPlan {
  const touch = ns ? new Set(ns) : null;
  return {
    ...plan,
    pages: plan.pages.map((p) => (!touch || touch.has(p.n) ? fn({ ...p }) : { ...p })),
  };
}

/**
 * „Poolita kõik" (või valikule „Poolita"): nosplit → default.
 * `custom` jääb PUUTUMATA — käsitsi tehtud töö on väärtuslikum kui hulgikäsk (§7).
 * Nimi on tahtlik: see EI ole „poolita", vaid „rakenda üldjoont".
 */
export function applyDefaultSplitTo(plan: PrepressPlan, ns?: number[]): PrepressPlan {
  return mapPages(plan, ns, (p) => (p.mode === 'custom' ? p : { ...p, mode: 'default', split_x: null }));
}

/**
 * „Eemalda üldpoolitus": default → nosplit. `custom` jääb puutumata (§2).
 * Vana nimi „Ära poolita ühtki" lubas rohkem, kui see teeb.
 */
export function clearDefaultSplit(plan: PrepressPlan): PrepressPlan {
  return mapPages(plan, undefined, (p) => (p.mode === 'default' ? { ...p, mode: 'nosplit', split_x: null } : p));
}

/**
 * Tegevusriba „Ära poolita": valitud lehed → nosplit, KA custom.
 * Kaitse kehtib globaalsetele nuppudele, mitte valikule — kasutaja näitas
 * need lehed nimeliselt kätte (§7).
 */
export function setNoSplit(plan: PrepressPlan, ns: number[]): PrepressPlan {
  return mapPages(plan, ns, (p) => ({ ...p, mode: 'nosplit', split_x: null }));
}

/**
 * „Ära OCR-i" / „Lisa OCR-i". Puudutab AINULT `excluded` välja: poolitusolek
 * säilib ja hakkab uuesti kehtima, kui leht OCR-i tagasi lisatakse (§11).
 */
export function setExcluded(plan: PrepressPlan, ns: number[], excluded: boolean): PrepressPlan {
  return mapPages(plan, ns, (p) => ({ ...p, excluded }));
}

/** „27 lehte sai üldjoone, 3 käsitsi seatut jäi puutumata" — riba teate arvud (§7). */
export function countByMode(plan: PrepressPlan, ns: number[]): { applied: number; keptCustom: number } {
  const touch = new Set(ns);
  const picked = plan.pages.filter((p) => touch.has(p.n));
  const keptCustom = picked.filter((p) => p.mode === 'custom').length;
  return { applied: picked.length - keptCustom, keptCustom };
}
```

Lisa `PrepressPage` import faili päisesse.

- [ ] **Step 4: Käivita testid**

Run: `npm test -- prepressPlan && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/pages/upload/prepressPlan.ts src/pages/upload/__tests__/prepressPlan.test.ts
git commit -m "feat(upload): plaani hulgioperatsioonid puhta moodulina (#255)"
```

### Task 7: Kaart saab lehekülgede halduse keele

Spekk §4, §8 ja „Visuaalne keel". Karkass tuleb `PageCard`-ist, žestid
ülevaatuse enda vajadusest.

**Files:**
- Modify: `src/pages/upload/components/SplitContactSheet.tsx`, `src/locales/et/upload.json`, `src/locales/en/upload.json`

**Interfaces:**
- Consumes: `isPreviewReady`, `willSplit` (olemas)
- Produces: `SplitContactSheet` uued propid:
  ```ts
  interface Props {
    uploadId: string;
    token: string | null;
    plan: PrepressPlan;
    gridCols: number;
    selected: Set<number>;
    onToggleSelect: (n: number, shiftKey: boolean) => void;
    onPageChange: (n: number, patch: Partial<PrepressPage>) => void;
    onOpenPage: (n: number) => void;
  }
  ```

- [ ] **Step 1: Lisa i18n võtmed MÕLEMASSE keelde**

`src/locales/et/upload.json` → `step3split`: eemalda `optIn`, `optInHint`,
`optInHintModel`, `exclude`, `include`, `noSplit`, `openPage`, `summary`; lisa:

```json
"title": "Lehtede ülevaatus",
"card": {
  "select": "Vali leht",
  "exclude": "Jäta OCR-ist välja",
  "include": "Lisa OCR-i",
  "split": "Poolita",
  "noSplit": "Ära poolita",
  "open": "Ava täisvaade"
}
```

`src/locales/en/upload.json` — sama struktuur:

```json
"title": "Review pages",
"card": {
  "select": "Select page",
  "exclude": "Exclude from OCR",
  "include": "Include in OCR",
  "split": "Split",
  "noSplit": "Don't split",
  "open": "Open full view"
}
```

**Sildistuse reegel (§8):** `title`/`aria-label` ütleb TEGEVUSE
(„Jäta OCR-ist välja" / „Lisa OCR-i"), olekut kannab `aria-pressed`. Mockup'i
olekusõnastus („Läheb OCR-i", „Ei poolitata") jääb kõrvale.

- [ ] **Step 2: Kirjuta komponent ümber**

Asenda `SplitContactSheet.tsx` sisu:

```tsx
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Columns2, Eye, EyeOff, Loader2, Maximize2 } from 'lucide-react';
import { prepressPreviewUrl } from '../uploadApi';
import { isPreviewReady, willSplit } from '../prepressPlan';
import type { PrepressPage, PrepressPlan } from '../types';

interface Props {
  uploadId: string;
  token: string | null;
  plan: PrepressPlan;
  gridCols: number;
  selected: Set<number>;
  onToggleSelect: (n: number, shiftKey: boolean) => void;
  onPageChange: (n: number, patch: Partial<PrepressPage>) => void;
  onOpenPage: (n: number) => void;
}

/** Nurgaikooni kest — sama geomeetria kui PageCard tegevusnupul.
 *  must = see leht erineb vaikeolekust (§8); hall = vaikeolek. */
const cornerBtn = (active: boolean) =>
  `p-1 rounded shadow-sm border transition-colors ${
    active
      ? 'bg-gray-900 border-gray-900 text-white'
      : 'bg-white/90 border-gray-600 text-gray-600 hover:bg-gray-100 hover:text-gray-800'
  }`;

/**
 * Lehtede ülevaatuse ruudustik. Karkass on `manage/PageCard`-ist (sama kest,
 * märkeruut, nurgad), žestid ülevaatuse omad: klõps pisipildil VALIB,
 * täisvaate avab eraldi nurgaikoon (§4).
 */
const SplitContactSheet: React.FC<Props> = ({
  uploadId, token, plan, gridCols, selected, onToggleSelect, onPageChange, onOpenPage,
}) => {
  const { t } = useTranslation(['upload']);

  return (
    <div
      data-testid="split-contact-sheet"
      className="grid gap-3 p-4"
      style={{ gridTemplateColumns: `repeat(${gridCols}, 1fr)` }}
    >
      {plan.pages.map((page) => {
        const ready = isPreviewReady(plan, page.n);
        const splits = willSplit(plan, page.n);
        const isSelected = selected.has(page.n);
        const x = page.mode === 'custom' && page.split_x != null
          ? page.split_x
          : plan.default_split_x;
        return (
          <div
            key={page.n}
            data-testid={`page-${page.n}`}
            data-excluded={page.excluded ? 'true' : 'false'}
            className={`relative flex flex-col rounded-lg border overflow-hidden bg-white ${
              isSelected ? 'border-primary-500 ring-2 ring-primary-400' : 'border-gray-200'
            }`}
          >
            {/* Kogu pisipildi-ala on valiku-sihtmärk; select-none väldib
                Shift+klõpsu teksti-esiletõstu üle ruudustiku (PageCard muster). */}
            <div
              className="relative aspect-[3/4] bg-gray-100 overflow-hidden cursor-pointer select-none"
              onClick={(e) => onToggleSelect(page.n, e.shiftKey)}
              title={t('step3split.card.select')}
            >
              {ready ? (
                <img
                  src={prepressPreviewUrl(uploadId, page.n, token)}
                  alt={`${page.n}`}
                  loading="lazy"
                  /* Tuhmub PILT, mitte kaart — muidu tuhmuvad ka ikoonid ja
                     väljajätmist ei saa kaardilt tagasi võtta (§8). Tuhmus
                     tähendab täpselt üht asja: ei lähe OCR-i (§11). */
                  className={`w-full h-full object-cover ${page.excluded ? 'opacity-35' : ''}`}
                />
              ) : (
                <div
                  data-testid={`placeholder-${page.n}`}
                  className="flex h-full w-full items-center justify-center"
                >
                  <Loader2 size={18} className="animate-spin text-gray-400" />
                </div>
              )}

              {ready && splits && (
                <div
                  data-testid={`line-${page.n}`}
                  className="absolute top-0 bottom-0 w-px bg-rose-600 pointer-events-none"
                  style={{ left: `${x * 100}%` }}
                />
              )}

              {/* Märkeruut — eraldi klõpsatav, klaviatuuri jaoks */}
              <button
                type="button"
                data-testid={`select-${page.n}`}
                onClick={(e) => { e.stopPropagation(); onToggleSelect(page.n, e.shiftKey); }}
                aria-pressed={isSelected}
                title={t('step3split.card.select')}
                className={`absolute top-1 left-1 z-10 w-5 h-5 flex items-center justify-center rounded border shadow-sm ${
                  isSelected ? 'bg-primary-600 border-primary-600 text-white'
                    : 'bg-white/90 border-gray-600 text-transparent'
                }`}
              >
                <Check size={13} />
              </button>

              {/* Lehenumber — all vasakul. Hall: upload'is seisundit veel ei ole. */}
              <span className="absolute bottom-1 left-1 text-xs px-1 py-0.5 rounded leading-tight shadow-sm bg-gray-100 text-gray-600">
                {page.n}
              </span>

              {/* Kolm nurgaikooni: [silm] [|] [suurenda] — OCR, poolitus, ava (§4) */}
              <div className="absolute bottom-1 right-1 z-10 flex items-center gap-1">
                <button
                  type="button"
                  data-testid={`exclude-${page.n}`}
                  onClick={(e) => { e.stopPropagation(); onPageChange(page.n, { excluded: !page.excluded }); }}
                  aria-pressed={page.excluded}
                  title={page.excluded ? t('step3split.card.include') : t('step3split.card.exclude')}
                  className={cornerBtn(page.excluded)}
                >
                  {page.excluded ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                <button
                  type="button"
                  data-testid={`split-${page.n}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPageChange(page.n, {
                      mode: page.mode === 'nosplit' ? 'default' : 'nosplit',
                      split_x: null,
                    });
                  }}
                  aria-pressed={page.mode !== 'nosplit'}
                  title={page.mode === 'nosplit' ? t('step3split.card.split') : t('step3split.card.noSplit')}
                  className={cornerBtn(page.mode !== 'nosplit')}
                >
                  <Columns2 size={14} />
                </button>
                <button
                  type="button"
                  data-testid={`open-${page.n}`}
                  onClick={(e) => { e.stopPropagation(); onOpenPage(page.n); }}
                  disabled={!ready}
                  title={t('step3split.card.open')}
                  className={`${cornerBtn(false)} disabled:opacity-40`}
                >
                  <Maximize2 size={14} />
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default SplitContactSheet;
```

Kolm asja, mis siin erinevad mockup'ist ja on TAHTLIKUD (vt spekk):
`Maximize2` tähendab nüüd „suurenda" (mitte „ära poolita"); valikut näitavad
ring + märkeruut (mitte lehenumbri värv — merevaik tähendab `manage`-is
„salvestamata muudatus"); väljajätmine tuhmib `<img>`-i, mitte kaarti.

- [ ] **Step 3: Väravad**

Run: `npm run typecheck`
Expected: FAIL `UploadStepSplit.tsx`-is (uued kohustuslikud propid) — see on
oodatud ja laheneb Task 9-s. Kui tahad rohelist väravat enne, tee Task 7 ja 9
ühes commitis.

- [ ] **Step 4: Commit**

```bash
git add src/pages/upload/components/SplitContactSheet.tsx src/locales/et/upload.json src/locales/en/upload.json
git commit -m "feat(upload): ülevaatuse kaart PageCard-i keelde, kolm nurgaikooni (#255)"
```

### Task 8: `SplitActionBar` — hulgitegevuste riba

Spekk §5, §6. Karkass `PageActionBar`-ist **muutmata**; ülemine riba oleks
vale, sest 143-lehelisel tööl kaob see kerides ära.

**Files:**
- Create: `src/pages/upload/components/SplitActionBar.tsx`
- Modify: `src/locales/{et,en}/upload.json`

**Interfaces:**
- Produces:
  ```ts
  interface SplitActionBarProps {
    selectedCount: number;
    onSplit: () => void;
    onNoSplit: () => void;
    onExclude: () => void;
    onInclude: () => void;
    onClearSelection: () => void;
    resultText: string | null;   // „27 lehte sai üldjoone, 3 käsitsi seatut jäi puutumata"
  }
  ```

- [ ] **Step 1: i18n mõlemasse keelde**

et `step3split`:
```json
"bar": {
  "count": "Valitud: {{count}}",
  "split": "Poolita",
  "noSplit": "Ära poolita",
  "exclude": "Ära OCR-i",
  "include": "Lisa OCR-i",
  "clear": "Tühista valik",
  "shiftHint": "Shift+klõps valib vahemiku",
  "splitResult": "{{applied}} lehte sai üldjoone, {{kept}} käsitsi seatut jäi puutumata"
}
```
en:
```json
"bar": {
  "count": "Selected: {{count}}",
  "split": "Split",
  "noSplit": "Don't split",
  "exclude": "Skip OCR",
  "include": "Include in OCR",
  "clear": "Clear selection",
  "shiftHint": "Shift+click selects a range",
  "splitResult": "{{applied}} pages got the global line, {{kept}} manual lines left untouched"
}
```

- [ ] **Step 2: Loo komponent**

```tsx
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Columns2, Eye, EyeOff, X } from 'lucide-react';

interface SplitActionBarProps {
  selectedCount: number;
  onSplit: () => void;
  onNoSplit: () => void;
  onExclude: () => void;
  onInclude: () => void;
  onClearSelection: () => void;
  resultText: string | null;
}

/**
 * Hõljuv hulgitegevuste riba upload'i ülevaatuses.
 *
 * Karkass on `manage/PageActionBar`-ist 1:1 — kaks ekraani peavad välja nägema
 * nagu üks süsteem. z-[1100] on TEADLIKULT päise (`sticky z-[1200]`) all.
 *
 * Käsud on mõlemasuunalised (§6): ühesuunaline „Ära OCR-i" oleks lõks —
 * kogemata valitud 80 lehte saaks korraga välja jätta, aga tagasi ainult
 * ükshaaval. Kaardil on sama asi toggle, siin idempotentsed käsud.
 */
const SplitActionBar: React.FC<SplitActionBarProps> = (props) => {
  const { t } = useTranslation(['upload']);
  if (props.selectedCount === 0) return null;

  const btn = 'flex items-center gap-1.5 px-2.5 py-1 text-sm border border-gray-300 text-gray-700 hover:bg-gray-50 rounded';

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[1100] flex justify-center px-3 pb-3 pointer-events-none">
      <div className="pointer-events-auto w-full max-w-4xl rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden">
        {props.resultText && (
          <div className="px-4 py-2 border-b border-gray-100 text-sm text-gray-600">
            {props.resultText}
          </div>
        )}
        <div className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-sm font-medium text-primary-800 shrink-0">
            {t('step3split.bar.count', { count: props.selectedCount })}
          </span>

          {/* Poolitusrühm */}
          <div className="flex items-center gap-1.5 border-l border-gray-200 pl-3">
            <button type="button" onClick={props.onSplit} className={btn}>
              <Columns2 size={14} />{t('step3split.bar.split')}
            </button>
            <button type="button" onClick={props.onNoSplit} className={btn}>
              {t('step3split.bar.noSplit')}
            </button>
          </div>

          {/* OCR-rühm — mõlemasuunaline (§6) */}
          <div className="flex items-center gap-1.5 border-l border-gray-200 pl-3">
            <button type="button" onClick={props.onExclude} className={btn}>
              <EyeOff size={14} />{t('step3split.bar.exclude')}
            </button>
            <button type="button" onClick={props.onInclude} className={btn}>
              <Eye size={14} />{t('step3split.bar.include')}
            </button>
          </div>

          <button
            type="button"
            onClick={props.onClearSelection}
            className="flex items-center gap-1 px-2 py-1 text-sm font-medium text-red-600 hover:bg-red-50 rounded border-l border-gray-200 pl-3"
          >
            <X size={15} />{t('step3split.bar.clear')}
          </button>

          <span className="w-full text-xs text-gray-500">{t('step3split.bar.shiftHint')}</span>
        </div>
      </div>
    </div>
  );
};

export default SplitActionBar;
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/upload/components/SplitActionBar.tsx src/locales/
git commit -m "feat(upload): hulgitegevuste riba PageActionBar karkassil (#255)"
```

### Task 9: `UploadStepSplit` — alati nähtav ülevaatus

Spekk §1, §2, §3, §10. Siin ühendatakse kõik eelnev: opt-in kaob, eelvaade
käivitub automaatselt, valikuolek elab siin.

**Files:**
- Modify: `src/pages/upload/components/UploadStepSplit.tsx`, `src/locales/{et,en}/upload.json`

**Interfaces:**
- Consumes: `applyDefaultSplitTo`, `clearDefaultSplit`, `setNoSplit`, `setExcluded`, `countByMode`, `summarizePlan` (Task 6); `SplitContactSheet` (Task 7); `SplitActionBar` (Task 8); `setOcrModel` (Task 5)

- [ ] **Step 1: i18n mõlemasse keelde**

et `step3split` lisandub:
```json
"splitAll": "Poolita kõik",
"clearGlobalSplit": "Eemalda üldpoolitus",
"model": { "label": "OCR-mudel", "print": "Trükis", "hand": "Käsikiri", "locked": "Mudelit saab muuta ainult enne OCR-i saatmist" },
"selectAll": "Vali kõik",
"selectSplit": "Vali poolitatud",
"summaryNoSplit": "poolitusi pole · OCR-i läheb {{output}} lehte · välja jäetud {{excluded}}",
"summarySplit": "poolitatakse {{split}} · OCR-i läheb {{output}} lehte · välja jäetud {{excluded}}",
"gridSmaller": "Väiksemad pisipildid",
"gridLarger": "Suuremad pisipildid",
"gridColumns": "Pisipiltide suurus"
```
en:
```json
"splitAll": "Split all",
"clearGlobalSplit": "Remove global split",
"model": { "label": "OCR model", "print": "Print", "hand": "Handwriting", "locked": "The model can only be changed before sending to OCR" },
"selectAll": "Select all",
"selectSplit": "Select split",
"summaryNoSplit": "no splits · {{output}} pages go to OCR · {{excluded}} excluded",
"summarySplit": "{{split}} will be split · {{output}} pages go to OCR · {{excluded}} excluded",
"gridSmaller": "Smaller thumbnails",
"gridLarger": "Larger thumbnails",
"gridColumns": "Thumbnail size"
```

- [ ] **Step 2: Teosta**

Muudatused `UploadStepSplit.tsx`-is, ükshaaval:

1. **Opt-in kastike kaob täielikult.** Selle asemel käivitub eelvaade
   automaatselt esimesel monteerimisel:

```tsx
  // Ülevaatus on ALATI nähtav (§1) — eelvaade käivitub ise. startPrepress on
  // idempotentne (preview_status === 'rendering' → tagasi), seega StrictMode'i
  // topeltkutse on ohutu.
  useEffect(() => {
    let cancelled = false;
    startPrepress(uploadId, token)
      .then(() => getPrepress(uploadId, token))
      .then((p) => { if (!cancelled) setPlan(p); })
      .catch(() => { if (!cancelled) setError(t('step3split.renderError')); });
    return () => { cancelled = true; };
  }, [uploadId, token, t]);
```
   (See asendab olemasoleva „loe plaan" effecti.)

2. **Valikuolek** — täpselt `WorkManage.handleToggle` muster, sh ankru
   lugemine ENNE `setState`-i:

```tsx
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const lastSelectedRef = useRef<number | null>(null);

  const handleToggleSelect = (n: number, shiftKey: boolean) => {
    const idx = plan ? plan.pages.findIndex((p) => p.n === n) : -1;
    // Loe ankur ENNE setState'i: updater jookseb hiljem, aga ref kirjutatakse
    // üle juba allpool — laisk lugemine kahandaks vahemiku üheks elemendiks.
    const anchor = lastSelectedRef.current;
    setSelected((prev) => {
      const next = new Set(prev);
      if (shiftKey && anchor !== null && plan) {
        const [lo, hi] = [anchor, idx].sort((a, b) => a - b);
        for (let i = lo; i <= hi; i++) next.add(plan.pages[i].n);
      } else if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
    lastSelectedRef.current = idx;
  };
```

3. **Hulgikäsud** — üks plaani salvestus, mitte N päringut:

```tsx
  const selectedNs = useMemo(() => Array.from(selected), [selected]);
  const [barResult, setBarResult] = useState<string | null>(null);

  const handleSplitAll = () => {
    if (!plan) return;
    const { applied, keptCustom } = countByMode(plan, plan.pages.map((p) => p.n));
    persist(applyDefaultSplitTo(plan));
    setBarResult(keptCustom > 0
      ? t('step3split.bar.splitResult', { applied, kept: keptCustom })
      : null);
  };
  const handleClearGlobalSplit = () => { if (plan) persist(clearDefaultSplit(plan)); };
  const handleBarSplit = () => { if (plan) persist(applyDefaultSplitTo(plan, selectedNs)); };
  const handleBarNoSplit = () => { if (plan) persist(setNoSplit(plan, selectedNs)); };
  const handleBarExclude = () => { if (plan) persist(setExcluded(plan, selectedNs, true)); };
  const handleBarInclude = () => { if (plan) persist(setExcluded(plan, selectedNs, false)); };
```

4. **Päis:** mudelilüliti + poolitusjoone väli + „Poolita kõik" (primaar,
   `bg-primary-600`) + „Eemalda üldpoolitus" (sekundaar, outline). Mitteaktiivne
   mudelipool peab olema **selgelt hämaram** (hall tekst hallil), muidu ei ole
   ühe pilguga näha, kumb kehtib (§3). Mudelivahetus kutsub `setOcrModel` ja
   409 korral näitab `t('step3split.model.locked')`.

5. **Paneeli päis:** vasakul pealkiri `font-semibold text-gray-800`, paremal
   „Vali kõik" / „Vali poolitatud" (`px-2 py-1 text-xs border rounded`) ja
   loendur `text-sm text-gray-500`. Valikuabid **ei kuulu tegevusribale** —
   nad valivad, ei muuda midagi (§10).

```tsx
  const handleSelectAll = () => setSelected(new Set(plan!.pages.map((p) => p.n)));
  const handleSelectSplit = () =>
    setSelected(new Set(plan!.pages.filter((p) => willSplit(plan!, p.n)).map((p) => p.n)));
```

6. **Ruudustiku juhtnupp** `−` · liugur · `+` — `WorkManage` koodiga identne
   (`MIN_COLS = 3`, `MAX_COLS = 10`, `gridCols` algväärtus 5, liuguri väärtus
   pööratud `MAX_COLS + MIN_COLS - gridCols`).

7. **Kokkuvõte** kasutab kahte võtit:

```tsx
  const summary = summarizePlan(plan);
  const summaryText = summary.split > 0
    ? t('step3split.summarySplit', { split: summary.split, output: summary.output, excluded: summary.excluded })
    : t('step3split.summaryNoSplit', { output: summary.output, excluded: summary.excluded });
```

8. **Alumine polsterdus:** kui riba on nähtaval, lisa ruudustiku konteinerile
   `pb-24`, et viimane rida ei jääks riba taha (sama võte kui `WorkManage`-is).

9. `handleContinue` salvestab tingimusteta (`enabled` on kadunud) ja kutsub
   `applyPrepress` — apply lubatud ka `prepping`-ust (Task 4), seega „Edasi"
   töötab ka renderduse ajal.

- [ ] **Step 3: Väravad**

Run: `npm run typecheck && npm test && npm run lint:ci`
Expected: kõik PASS

- [ ] **Step 4: Käsitsi kontroll**

`npm run dev` → `/upload`, laadi 5-leheline PDF. Kontrolli:
ülevaatus avaneb kohe kohatäidetega; „Poolita kõik" annab kõigile joone;
„Eemalda üldpoolitus" võtab maha ainult üldjoone; Shift+klõps valib vahemiku;
riba ilmub valikuga ja kaob „Tühista valik" peale.

- [ ] **Step 5: Commit**

```bash
git add src/pages/upload/components/UploadStepSplit.tsx src/locales/
git commit -m "feat(upload): ülevaatus on alati nähtav; hulgivalik ja -käsud (#255)"
```

### Task 10: Täisvaade — „Ära OCR-i" ja ühtne ikoonikeel

Spekk §9. Praegu on täisvaates ainult „Lähtesta üldjoonele" ja „Ära poolita",
ning `‹ ›` on riba vastasservas.

**Files:**
- Modify: `src/pages/upload/components/SplitPageDetail.tsx`, `src/locales/{et,en}/upload.json`

- [ ] **Step 1: i18n mõlemasse keelde**

et: `"detail": { "header": "Lk {{n}} · {{total}}-st · poolitatakse joonelt {{percent}}%", "headerNoSplit": "Lk {{n}} · {{total}}-st · ei poolitata", "arrowHint": "← → liigub lehtede vahel", "resetToGlobal": "Lähtesta üldjoonele" }`

en: `"detail": { "header": "Page {{n}} of {{total}} · split at {{percent}}%", "headerNoSplit": "Page {{n}} of {{total}} · not split", "arrowHint": "← → moves between pages", "resetToGlobal": "Reset to global line" }`

- [ ] **Step 2: Teosta**

1. Tegevusriba uus järjestus **ühes rühmas**:
   `Ülevaatesse | ‹ › | Ära poolita · Ära OCR-i · Lähtesta üldjoonele`.
2. Uus nupp „Ära OCR-i" — **toggle**, seega silt pöördub oleku järgi:
   väljajäetud lehel `t('step3split.card.include')`, muidu
   `t('step3split.card.exclude')`; `aria-pressed={page.excluded}`; ikoon
   `EyeOff`/`Eye` (samad, mis kaardil — §8).
3. „Ära poolita" nupp saab ikooni `Columns2` ja `aria-pressed={page.mode !== 'nosplit'}`;
   silt pöördub samamoodi (`card.split` / `card.noSplit`).
4. Päis kasutab uut `detail.header` / `detail.headerNoSplit` mikroteksti;
   `detail.arrowHint` läheb riba alla väikese tekstina.
5. `Ban`-ikoon kaob — väljajätmist ja poolitamata jätmist eristavad nüüd samad
   kaks ikooni, mis kaardil.

- [ ] **Step 3: Väravad ja käsitsi kontroll**

Run: `npm run typecheck && npm test && npm run lint:ci`
Käsitsi: täisvaade avaneb kaardi nurgaikoonist; lehe saab välja jätta ilma
ülevaatesse naasmata; nooled liiguvad lehtede vahel.

- [ ] **Step 4: Commit**

```bash
git add src/pages/upload/components/SplitPageDetail.tsx src/locales/
git commit -m "feat(upload): täisvaates Ära OCR-i ja ühtne ikoonikeel (#255)"
```

### Task 11: ADR ja dokumentatsioon

ADR 0017 ütleb: „puutumata lülitiga upload ei renderda ühtki pikslit ja käib
tänast PDF-teed." Alati nähtav ülevaatus muudab selle põhimõtte poolikuks —
see nõuab uut ADR-i, mitte ainult vestlust.

**Files:**
- Create: `docs/decisions/0026-ulevaatus-on-alati-nahtav.md`
- Modify: `docs/decisions/0017-*.md` (staatuse rida), `docs/decisions/README.md`, `server/upload/page_source.py`, `CLAUDE.md`

- [ ] **Step 1: Kontrolli järgmine vaba ADR-number**

Run: `ls docs/decisions/ | tail -3`
Expected: viimane on `0025-ocr-vea-margend-err.md` → uus on **0026**. Kui
vahepeal on tekkinud 0026, võta järgmine vaba (ADR-numbrid põrkuvad harude vahel).

- [ ] **Step 2: Kirjuta ADR 0026**

Sisu (järgi `docs/decisions/` olemasolevat vormi):

- **Kontekst:** mõõdetud 2026-08-24, 143-leheline töö: eelvaade 82,6 s = 0,58 s/lk, 26,2 MB staging'us. Koodi kommentaar lubas ~0,05 s/lk — 11× optimistlik.
- **Otsus:** 100 DPI eelvaade renderdatakse **iga** upload'i puhul; opt-in kastike kaob.
- **Mis EI muutu:** apply kiirtee. Poolitusteta plaan saadab endiselt PDF-i ega renderda ühtki 300 DPI pikslit — puutumata plaan originaalina, ainult-väljajätmistega plaan ~36 s alamhulga-ehituse järel. **Kallis osa jääb opt-in-iks; odav osa muutub kohustuslikuks.**
- **Tagajärjed:** `APPLY_START_STATUSES` sisaldab `"prepping"`; apply katkestab eelvaate (`preview_cancel`), sest mõlemad jagavad `RENDER_SEMAPHORE(1)`-i ja katkestamata renderdus kahekordistaks apply aja.
- **Invariandid, mis siit järelduvad:**
  - Vaikeplaanis on kõik lehed `mode: "nosplit"`; `default_split_x` on üldjoone väärtus, mis rakendub alles „Poolita kõik" käsuga.
  - `excluded` ja `mode` on risti: väljajätmine domineerib väljundi koostamisel, aga EI kustuta poolitusolekut.
  - `ocr_model` on töötlusotsus omas state-väljas; `meta.type` on bibliograafiline väide ja seda EI muudeta vaikselt.
  - `preview_cancel` on ühe tsükli lipp: `prepress/start` nullib selle.
  - Väljajätmine toimib MÕLEMAL triviaalteel; ebaõnnestunud PDF-alamhulk langeb vaikselt rasterteele ja logib `warning`-u.
- **Asendab:** `feat/upload-ocr-katkestamine` plaani Task 7 (mudelivahetus `meta.type` kaudu).

- [ ] **Step 3: Uuenda viited**

- `docs/decisions/0017-*.md`: lisa päisesse rida
  „**Osaliselt asendatud:** ADR 0026 — opt-in-põhimõte kehtib ainult 300 DPI läbikäigule."
- `docs/decisions/README.md`: uus rida registrisse.
- `server/upload/page_source.py`: `PREVIEW_DPI` kommentaar
  `# kontaktlehe pisipilt — odav, ~0,05 s/lk` → `~0,58 s/lk (mõõdetud 2026-08-24, 143 lk / 82,6 s)`.
- `CLAUDE.md` „Poolitamine enne OCR-i (ADR 0017)" plokk: asenda esimene lause
  („prepress on tervikuna opt-in") ADR 0026 semantikaga ja lisa read `excluded` ×
  `mode` risti-invariandi ning `preview_cancel` kohta.

- [ ] **Step 4: Väravad ja commit**

```bash
.venv/bin/pytest tests/ -q && npm test && npm run typecheck && npm run lint:ci
git add docs/decisions/ server/upload/page_source.py CLAUDE.md
git commit -m "docs(adr): 0026 — ülevaatus on alati nähtav, opt-in jääb 300 DPI teele (#255)"
```

- [ ] **Step 5: Ava PR B**

```bash
git push -u origin feat/upload-lehtede-ulevaatus
gh pr create --base main --title "feat(upload): lehtede ülevaatus enne OCR-i (#255)"
```

**NB:** kui PR A ei ole veel main'is, on see virnastatud PR ja **checke ei saa**.
Pärast A merge't: suuna baas ümber ja tee **close + reopen** (baasi ümbersuunamine
üksi EI käivita CI-d).

---

## Self-Review

**Spekki kaetus** — iga otsus → task:

| Spekk | Task |
|---|---|
| §1 Ülevaatus on alati nähtav | 9 (+ ADR 11) |
| §2 Vaikimisi ei poolitata; „Poolita kõik" / „Eemalda üldpoolitus" | 3, 6, 9 |
| §3 OCR-mudelit saab ülevaatuses muuta | 5, 9 |
| §4 Valikurežiimi ei ole; täisvaate avab nurgaikoon | 7, 9 |
| §5 Hulgitegevused hõljuval alumisel ribal | 8 |
| §6 Valiku peal käsud (mõlemasuunalised), kaardi peal toggle | 6, 8, 10 |
| §7 „Poolita kõik" ei kirjuta üle käsitsi seatud jooni | 6 |
| §8 Üks ikoonisüsteem kõikjal | 7, 10 |
| §9 Täisvaates „Ära OCR-i" | 10 |
| §10 Valikuabid päises, suuruse juhtnupp all | 9 |
| §11 `excluded` ja `mode` on risti | 3, 6 (+ ADR 11) |
| Viga A (`mode: "default"` semantika) | 3 |
| Viga B (väljajätmine on no-op) | 1, 2 |
| `preview_cancel` ja apply `prepping`-ust | 4 |
| Mõju ADR 0017-le | 11 |

**Kaks kohta, mida spekk ei maininud ja mis plaani lisandusid:**

1. **Legacy-plaanide migratsioon** (Task 3, Step 3–4). Staging'us olevatel
   upload'idel on `enabled: False` + kõik lehed `mode: "default"`. Guardi
   eemaldamine ilma `normalize_legacy_plan`-ita paneks need lehed korraga 50%
   pealt poolituma. See on live-andmete oht, mitte teoreetiline.
2. **Renderdaja ei tohi apply staatust üle kirjutada** (Task 4, Step 4).
   `_render_previews` lõpetab täna alati `set_upload_state(status="awaiting_split")`-iga;
   pärast `preview_cancel`-i on staatus `"applying"` ja selle tagasilükkamine
   lubaks teise apply CAS-i sisse (topelt-SFTP).

**Üks teadlik piirang:** frontendi komponente ei kata ükski automaattest
(repos puudub testing-library ja `vitest` jookseb `environment: 'node'`).
Sellepärast on kogu otsustusloogika Task 6-s puhtas moodulis ning Task 9 ja 10
lõpevad käsitsi kontrolliga. Komponenditestide sisseseadmine on omaette töö —
kui see tehakse, on esimene katvuse siht `SplitContactSheet` valikužestid.

## Kontroll enne PR B sulgemist

Spekki „Kontroll" loend, käsitsi läbi mängituna 143-lehelise tööga:

- [ ] Ülevaatus avaneb kohe, kohatäidetega; eelvaated voogavad ~83 s jooksul
- [ ] „Poolita kõik" → kõik lehed saavad joone; käsitsi seatud joon jääb puutumata ja riba ütleb selle välja
- [ ] „Eemalda üldpoolitus" → üldjoonelt poolitatud lähevad `nosplit`-i, käsitsi seatud jooned jäävad
- [ ] Valik + „Ära OCR-i" → valitud lehtede PILT tuhmub (mitte kaart), kokkuvõte väheneb
- [ ] Sama valik + „Lisa OCR-i" → kõik tuleb tagasi ühe žestiga
- [ ] Käsitsi joon + „Ära OCR-i" + „Lisa OCR-i" → käsitsi seatud joon on alles (§11)
- [ ] Poolitamata leht EI näe välja väljajäetu moodi
- [ ] Mudeli vahetus enne apply't muudab kaugteed; pärast apply't 409
- [ ] Mudeli vahetus EI muuda `meta.type`-i — imporditud teose tüüp jääb metaandmete sammus valituks
- [ ] Täisvaade avaneb nurgaikoonist; klõps pisipildil ainult valib
- [ ] Täisvaates saab lehe välja jätta ilma ülevaatesse naasmata
- [ ] Kõrvuti avatud `/work/{id}/manage` ja ülevaatus näevad välja nagu üks süsteem
- [ ] Väljajäetud kaardil on ikoonid loetavad ja klõpsatavad
- [ ] **Väljajätmine ILMA poolitamiseta, PDF-ist:** väljajäetud leht EI jõua OCR-serverisse — kontrolli kaugkausta sisu (`ssh loss`), mitte ainult UI-d
- [ ] **Väljajätmine ILMA poolitamiseta, pildikaustast:** sama kontroll teisel harul
- [ ] Väljajätmisega töö jõuab sammus 4 `done`-i (`expected_pages` tuli plaanist)
- [ ] „Edasi" eelvaate renderduse ajal: apply käivitub kohe (ei 409) ega jookse poole kiirusega
- [ ] Katkestatud eelvaate saab uuesti käivitada ja ta ei lähe kohe `cancelled`-iks
- [ ] Puutumata plaan läheb endiselt originaal-PDF-ina, ilma 300 DPI renderduseta
