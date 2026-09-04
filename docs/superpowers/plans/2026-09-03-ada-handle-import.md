# ADA handle → VUTT impordi implementatsiooniplaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin annab ADA handle'i, VUTT tõmbab metaandmed vormi ja PDF-id serverisse, ning edasi jätkub tavaline upload-viisard, kus lehed vaadatakse üle enne OCR-i.

**Architecture:** Uus alampakett `server/ada/` (`mapping.py` puhas, `client.py` HTTP, `fetch.py` taustatöö) + kaks admin-endpointi. Viisardi sammud 1–2 saavad ADA-haru, sammud 3–4 (poolitamine, ülevaatus) jäävad **puutumata**. 65 PDF-i liidetakse `pdfunite`-ga üheks `source.pdf`-iks; seos lähtefailiga säilib lehe JSON-i `source` väljas + kommentaaris, ankur leitakse uue `prepress.page_map` kaudu.

**Tech Stack:** Python 3.9 (FastAPI, requests, poppler-utils `pdfunite`/`pdfinfo`), React 19 + TypeScript + Tailwind, pytest, vitest.

**Spec:** `docs/superpowers/specs/2026-09-03-ada-handle-import-design.md`

## Global Constraints

- **Python 3.9 ühilduvus:** `Optional[dict]`, MITTE `dict | None`. Kehtib igas uues failis.
- **Blokeeriv I/O `async def` sees on keelatud** (ADR 0002) — kas sync `def` route või `run_in_threadpool`.
- **Koodikommentaarid eesti keeles.**
- **Kõik uued endpointid `/admin/` all JA `require_role("admin")`** — nginx `/api/files/` proksib kõik backend-teed avalikult.
- **`prepress` alamvälju muudetakse AINULT `upload_state.mutate_prepress` kaudu** (ADR 0028). `set_upload_state(**extra)` seab terve ülemise taseme võtme.
- **i18n:** iga uus võti lisatakse **korraga** `src/locales/et/upload.json` JA `src/locales/en/upload.json` — `fallbackLng` on väljas, puuduv võti murrab buildi (`localeParity.test.ts`).
- **Väravad enne igat commit'i:** `.venv/bin/pytest tests/` (kasuta ALATI projekti venv-i, süsteemi `python3`-l puuduvad sõltuvused). Frontendi puudutavatel: `npm run typecheck`, `npm test`, `npm run lint:ci`.
- **Kasutatavad PDF-tööriistad:** ainult `pdfunite` ja `pdfinfo` (poppler-utils). `qpdf`, `pdftk`, `pypdf` EI OLE backend-konteineris olemas.
- **Ainult ORIGINAL-kimp ja ainult PDF-id.** `LICENSE`, `TEXT`, `THUMBNAIL` jäetakse alati vahele.

---

## File Structure

| Fail | Vastutus |
|---|---|
| `server/ada/__init__.py` | Pakett |
| `server/ada/mapping.py` | **Puhas.** DC → VUTT väljad, failinime kuupäeva parsimine, sortimine. Null I/O. |
| `server/ada/client.py` | Handle'i normaliseerimine + ADA REST päringud + vigade kaardistus |
| `server/ada/fetch.py` | Taustalõim: `.part`-allalaadimine, `pdfunite`, oleku üleminekud |
| `server/ada/provenance.py` | Ankru resolutsioon `page_map`-ist + `source`/kommentaari koostamine |
| `server/upload/prepress_apply.py` | **Muuta:** `page_map` kirjutamine |
| `server/upload/state.py` | **Muuta:** `page_map` nullimine apply alguses |
| `server/routers/editing.py` | **Muuta:** `source` võtme säilitamine lehe salvestusteel |
| `server/routers/upload.py` | **Muuta:** kaks uut endpointi |
| `server/upload/import_work.py` | **Muuta:** provenance'i kirjutamine imporditud lehtedele |
| `server/ocr_providers/gemini.py` | **Muuta:** tekstipoolne `translate_title()` |
| `src/pages/upload/adaApi.ts` | ADA endpointide klient |
| `src/pages/upload/components/AdaImportBar.tsx` | Sammu 1 ADA-riba + failiplaani kokkuvõte |
| `src/pages/upload/useUploadWizard.ts` | **Muuta:** ADA-haru sammudes 1–2 |
| `docs/decisions/0030-page-map-lahteleht-valjundlehtedeks.md` | ADR |

**Task order rationale:** Tasks 1–2 on ADA-st sõltumatud ja parandavad olemasolevaid vaikseid vigu — need lähevad esimesena, sest ülejäänu toetub neile. Task 12 (duplikaadi hoiatus) on viimane, sest see on ainus, mis tohib skoobist välja langeda.

---

## Task 1: `page_map` — lähteleht → väljundlehed

Ilma selleta maanduvad kõik ADA-viited valel leheküljel, kui admin jätab sammus 3 lehti välja. See on iseseisev parandus ja läheb main'i ka siis, kui ADA-töö venib.

**Files:**
- Modify: `server/upload/prepress_apply.py` (funktsioon `_transfer_pages`, read 134–210)
- Modify: `server/upload/state.py` (funktsioon `try_begin_applying`, read 215–240)
- Test: `tests/test_prepress_page_map.py` (uus)

**Interfaces:**
- Consumes: `upload_state.mutate_prepress(upload_id, fn)`, `prepress_plan.is_excluded(plan, n)`
- Produces: `state.json` → `prepress.page_map: Dict[str, List[int]]` — lähtelehe number (stringina) → järjestatud väljundlehtede numbrid. Lähteleht, mis ei andnud ühtki väljundit, kaardis EI esine.

- [ ] **Step 1: Kirjuta kukkuv test**

Loo `tests/test_prepress_page_map.py`:

```python
"""page_map: lähteleht → kõik temast tekkinud väljundlehed (ADR 0030)."""
import json
import os

import pytest
from PIL import Image

from server.upload import prepress_apply, state as upload_state


class FakeSftp:
    """Minimaalne SFTP-topis: mkdir nõuab vanemat, nagu päris paramiko."""

    def __init__(self):
        self.dirs = set()

    def put(self, local, remote, callback=None):
        parent = remote.rsplit("/", 1)[0]
        if parent not in self.dirs:
            raise FileNotFoundError(2, "No such file", remote)

    def rename(self, src, dst):
        pass

    def stat(self, path):
        if path not in self.dirs:
            raise FileNotFoundError(path)
        return object()

    def mkdir(self, path):
        self.dirs.add(path)

    def close(self):
        pass


@pytest.fixture
def upload(tmp_path, monkeypatch):
    """Kolme-leheline pildikaust upload'ina; tagastab upload_id."""
    monkeypatch.setattr(upload_state, "UPLOADS_DIR", str(tmp_path), raising=False)
    monkeypatch.setattr(prepress_apply.upload_state, "UPLOADS_DIR", str(tmp_path), raising=False)
    uid = "testupl1"
    src = tmp_path / uid / "source"
    src.mkdir(parents=True)
    for i in range(1, 4):
        Image.new("RGB", (200, 100), (120, 120, 120)).save(src / f"{i:03d}.jpg", "JPEG")
    state = {
        "id": uid, "status": "awaiting_split", "meta": {"slug": "test-abc"},
        "files": [], "remote_staging_path": "st", "remote_work_path": "st/wk",
    }
    (tmp_path / uid / "state.json").write_text(json.dumps(state), encoding="utf-8")
    upload_state.init_prepress(uid, 3)
    return uid


def _read_map(tmp_path, uid):
    s = json.loads((tmp_path / uid / "state.json").read_text(encoding="utf-8"))
    return s["prepress"].get("page_map")


def test_page_map_ilma_teisendusteta_on_uks_uhele(upload, tmp_path, monkeypatch):
    monkeypatch.setattr(prepress_apply.ocr_client, "sftp_open", lambda uid: FakeSftp())
    monkeypatch.setattr(prepress_apply, "publish_atomic", lambda *a, **k: None)
    prepress_apply._transfer_pages(
        upload, "test-abc", ("st", "st/wk"), "st/wk",
        upload_state.read_state(upload)["prepress"],
    )
    assert _read_map(tmp_path, upload) == {"1": [1], "2": [2], "3": [3]}


def test_poolitatud_leht_annab_kaks_valjundit(upload, tmp_path, monkeypatch):
    """src 2 poolitatakse → out 2 ja 3; src 3 nihkub 4-ks."""
    monkeypatch.setattr(prepress_apply.ocr_client, "sftp_open", lambda uid: FakeSftp())
    monkeypatch.setattr(prepress_apply, "publish_atomic", lambda *a, **k: None)
    plan = upload_state.read_state(upload)["prepress"]
    plan["pages"][1]["mode"] = "custom"
    plan["pages"][1]["split_x"] = 0.5
    prepress_apply._transfer_pages(upload, "test-abc", ("st", "st/wk"), "st/wk", plan)
    assert _read_map(tmp_path, upload) == {"1": [1], "2": [2, 3], "3": [4]}


def test_valjajaetud_leht_puudub_kaardist(upload, tmp_path, monkeypatch):
    """excluded leht EI ole kaardis — mitte tühja listiga, vaid puudub."""
    monkeypatch.setattr(prepress_apply.ocr_client, "sftp_open", lambda uid: FakeSftp())
    monkeypatch.setattr(prepress_apply, "publish_atomic", lambda *a, **k: None)
    plan = upload_state.read_state(upload)["prepress"]
    plan["pages"][1]["excluded"] = True
    prepress_apply._transfer_pages(upload, "test-abc", ("st", "st/wk"), "st/wk", plan)
    kaart = _read_map(tmp_path, upload)
    assert "2" not in kaart
    assert kaart == {"1": [1], "3": [2]}


def test_apply_algus_nullib_vana_kaardi(upload, tmp_path):
    """try_begin_applying lubab error → applying; vana katse kaart ei tohi jääda."""
    upload_state.mutate_prepress(upload, lambda p: p.update(page_map={"1": [1], "2": [2]}))
    upload_state.set_upload_state(upload, status="error")
    assert upload_state.try_begin_applying(upload) is True
    assert _read_map(tmp_path, upload) == {}
```

- [ ] **Step 2: Jooksuta test, veendu et kukub**

Run: `.venv/bin/pytest tests/test_prepress_page_map.py -v`
Expected: FAIL — `page_map` on `None` (`assert None == {"1": [1], ...}`) ja viimane test kukub `assert None == {}`.

- [ ] **Step 3: Lisa kaardi kirjutamine `_transfer_pages`-i**

`server/upload/prepress_apply.py`. Silmuse alguses (kohe pärast `out_index = 0`) lisa lokaalne koguja, ja MÕLEMAS kohas, kus `out_index += 1`, lisa number kogujasse. Kirjutus toimub sama `mutate_prepress` kutsega, mis juba `applied_done`-i uuendab.

Baithaaval kiirtee (praegune rida ~167):

```python
            kiirtee = _byte_copy_path(upload_id, source, plan, n)
            if kiirtee:
                out_index += 1
                name = remote_page_name(slug, out_index)
                publish_atomic(sftp, kiirtee, "{}/{}".format(remote_work, name))
                _write_thumb(upload_id, thumbs_dir, out_index, kiirtee)
                # ADR 0030: kaart PEAB katma ka baithaaval kiirtee — muutmata pilt
                # on kõige tavalisem juht, mitte erand.
                upload_state.mutate_prepress(
                    upload_id,
                    lambda p, n=n, outs=[out_index]: (
                        p.update(applied_done=n),
                        p.setdefault("page_map", {}).update({str(n): outs}),
                    ),
                )
                continue
```

Poolituse lõikesilmus (praegune rida ~191): kogu lõike numbrid kokku ja kirjuta silmuse järel:

```python
                lehe_valjundid = []
                for (x0, x1) in prepress_plan.page_cuts(plan, n, width):
                    out_index += 1
                    lehe_valjundid.append(out_index)
                    name = remote_page_name(slug, out_index)
                    ...
```

ja asenda silmuse lõpu `mutate_prepress` kutse (rida ~205):

```python
            upload_state.mutate_prepress(
                upload_id,
                lambda p, n=n, outs=lehe_valjundid: (
                    p.update(applied_done=n),
                    p.setdefault("page_map", {}).update({str(n): outs}),
                ),
            )
```

**NB:** `lehe_valjundid` tuleb initsialiseerida ENNE `try:` plokki, mille `finally` kustutab `full` faili — muidu jääb ta erandi korral defineerimata.

- [ ] **Step 4: Lisa kaardi nullimine `try_begin_applying`-usse**

`server/upload/state.py`, funktsioonis `try_begin_applying`, samas luku all kus `apply_attempts` kasvab ja `preview_cancel` seatakse (kasuta OTSE dikti, mitte `mutate_prepress` — `get_upload_lock` on tavaline `Lock`, mitte `RLock`, ja pesastatud kutse annaks ummikseisu):

```python
        # ADR 0030: kordus-apply võib joosta TEISE plaaniga. Vana kaardi võtmed
        # osutaksid eelmise katse nummerdusele — ankrud maanduksid valel lehel.
        prepress = s.get("prepress")
        if isinstance(prepress, dict):
            prepress["page_map"] = {}
```

- [ ] **Step 5: Jooksuta testid, veendu et lähevad läbi**

Run: `.venv/bin/pytest tests/test_prepress_page_map.py tests/test_prepress_apply.py tests/test_prepress_apply_bytecopy.py tests/test_prepress_apply_retry.py tests/test_prepress_state.py -v`
Expected: PASS, sh olemasolevad prepress-testid regressioonideta.

- [ ] **Step 6: Commit**

```bash
git add tests/test_prepress_page_map.py server/upload/prepress_apply.py server/upload/state.py
git commit -m "feat(prepress): page_map kaardistab lähtelehe kõigile väljundlehtedele

ADR 0030. Ilma kaardita ei tea ükski hilisem tarbija, milline lähteleht sai
millise väljundnumbri — väljajätmine või poolitamine nihutab kõik järgnevad.
Kaart nullitakse apply alguses, sest kordus võib joosta teise plaaniga."
```

---

## Task 2: Lehe JSON säilitab `source` võtme üle salvestuse

Ilma selleta pühib esimene Ctrl+S redaktoris provenance'i vaikselt ära. Iseseisev parandus, mis kaitseb iga tulevast serveripoolset lehe-välja.

**Files:**
- Modify: `server/routers/editing.py` (read 98–111)
- Test: `tests/test_page_json_source_preserved.py` (uus)

**Interfaces:**
- Produces: lehe JSON-i võti `source` elab üle redaktori salvestuse, täpselt nagu `sequence`.

- [ ] **Step 1: Kirjuta kukkuv test**

Loo `tests/test_page_json_source_preserved.py`:

```python
"""Lehe salvestus EI TOHI pühkida serveripoolseid võtmeid, mida klient ei tunne.

`editing.py` kirjutab meta_content'i kliendilt TERVIKUNA üle. `sequence` on
eraldi säilitatud; `source` (ADA provenance) peab käituma samamoodi.
"""
import json

from server.routers.editing import merge_serveripoolsed_valjad


def test_source_sailib_kui_klient_ei_saada():
    olemasolev = {"sequence": 500, "status": "Toores",
                  "source": {"provider": "ada", "name": "07.03.1813.pdf"}}
    kliendilt = {"sequence": 500, "status": "Parandatud", "comments": []}
    tulemus = merge_serveripoolsed_valjad(olemasolev, kliendilt)
    assert tulemus["source"] == {"provider": "ada", "name": "07.03.1813.pdf"}
    assert tulemus["status"] == "Parandatud"


def test_sequence_sailib_endiselt():
    """Olemasolev käitumine ei tohi katkeda."""
    tulemus = merge_serveripoolsed_valjad({"sequence": 700}, {"status": "Töös"})
    assert tulemus["sequence"] == 700


def test_klient_tohib_source_i_muuta_kui_saadab():
    """Säilitamine täidab AUGU, ei lukusta välja."""
    tulemus = merge_serveripoolsed_valjad(
        {"source": {"provider": "ada"}}, {"source": {"provider": "kasitsi"}}
    )
    assert tulemus["source"] == {"provider": "kasitsi"}


def test_meta_content_wrapper_kuju():
    """Vana kirjete kuju: väljad on meta_content-i sees."""
    tulemus = merge_serveripoolsed_valjad(
        {"meta_content": {"sequence": 300, "source": {"provider": "ada"}}}, {}
    )
    assert tulemus["sequence"] == 300
    assert tulemus["source"] == {"provider": "ada"}
```

- [ ] **Step 2: Jooksuta test, veendu et kukub**

Run: `.venv/bin/pytest tests/test_page_json_source_preserved.py -v`
Expected: FAIL — `ImportError: cannot import name 'merge_serveripoolsed_valjad'`.

- [ ] **Step 3: Ekstraheeri ja laienda säilitusloogika**

`server/routers/editing.py`. Lisa moodulitasandile:

```python
# Võtmed, mille SERVER kirjutab ja mida klient ei saada tagasi. Ilma nendeta
# pühiks iga redaktori salvestus need vaikselt ära — miski ei kuku, andmed
# lihtsalt kaovad. Uus serveripoolne lehe-väli LISATAKSE SIIA.
SERVERIPOOLSED_LEHE_VALJAD = ("sequence", "source")


def merge_serveripoolsed_valjad(olemasolev: dict, kliendilt: dict) -> dict:
    """Täidab kliendi meta_content'i augud kettal olevate serveriväljadega.

    Täidab AINULT augud: kui klient saatis välja, jääb kliendi oma peale.
    """
    tulemus = dict(kliendilt)
    wrapper = olemasolev.get("meta_content") if isinstance(olemasolev, dict) else None
    if not isinstance(wrapper, dict):
        wrapper = {}
    for vali in SERVERIPOOLSED_LEHE_VALJAD:
        vana = olemasolev.get(vali) if isinstance(olemasolev, dict) else None
        if vana is None:
            vana = wrapper.get(vali)
        if vana is not None and tulemus.get(vali) is None:
            tulemus[vali] = vana
    return tulemus
```

Asenda senine `sequence`-plokk (read ~103–110) selle kutsega:

```python
        if os.path.exists(json_path):
            try:
                existing = await run_in_threadpool(_read_json_file, json_path)
                meta_content = merge_serveripoolsed_valjad(existing, meta_content)
            except Exception:
                pass
```

- [ ] **Step 4: Jooksuta testid, veendu et lähevad läbi**

Run: `.venv/bin/pytest tests/test_page_json_source_preserved.py tests/test_allocate_sequences.py -v`
Expected: PASS.

- [ ] **Step 5: Jooksuta kogu backend-testikomplekt regressiooni vastu**

Run: `.venv/bin/pytest tests/ -q`
Expected: PASS (senine roheline arv säilib).

- [ ] **Step 6: Commit**

```bash
git add tests/test_page_json_source_preserved.py server/routers/editing.py
git commit -m "fix(editing): lehe salvestus säilitab serveripoolsed väljad

meta_content kirjutati kliendilt tervikuna üle ja säilitati eraldi ainult
sequence. Iga uus serveripoolne lehe-väli oleks kadunud esimese Ctrl+S peale,
ilma vea ja logita. SERVERIPOOLSED_LEHE_VALJAD on nüüd üks nimekiri."
```

---

## Task 3: `server/ada/mapping.py` — puhas DC → VUTT kaardistus

Kogu loogika, mis võib valesti minna, ilma võrguta testitav.

**Files:**
- Create: `server/ada/__init__.py`, `server/ada/mapping.py`
- Create: `tests/fixtures/ada/item.json`, `tests/fixtures/ada/bitstreams.json`
- Test: `tests/test_ada_mapping.py`

**Interfaces:**
- Produces:
  - `parse_failinime_kuupaev(nimi: str) -> Tuple[int, int, int, int, str]` — sortimisvõti `(aasta, kuu, päev, täpsus, nimi)`; täpsus 0=täis, 1=kuu, 2=aasta, 3=parsimatu.
  - `sordi_bitstreamid(bitstreams: List[dict]) -> List[dict]` — sorditud koopia.
  - `dc_vuttiks(item: dict) -> dict` — `{title, year, year_display, creators, languages, ester_id, archive_refs, external_url}`.
  - `KEELE_KAART: Dict[str, str]`

- [ ] **Step 1: Salvesta päris ADA vastused fixture'iteks**

Mockitud leping ei ole leping — need failid tulevad elavast API-st, mitte peast.

```bash
mkdir -p tests/fixtures/ada
curl -sSL 'https://dspace.ut.ee/server/api/pid/find?id=hdl:10062/7822' \
  -o tests/fixtures/ada/item.json
curl -sSL 'https://dspace.ut.ee/server/api/core/items/5a495195-44c1-463b-a425-643dc4dcf13f/bundles' \
  -o tests/fixtures/ada/bundles.json
curl -sSL 'https://dspace.ut.ee/server/api/core/bundles/acd9a484-d0a6-43a2-b19f-d8cd2dbde692/bitstreams?size=100' \
  -o tests/fixtures/ada/bitstreams.json
```

Kontrolli, et `item.json` sisaldab `"dspaceVersion"` asemel `"uuid": "5a495195-…"` ja
`bitstreams.json` `page.totalElements == 65`.

- [ ] **Step 2: Kirjuta kukkuv test**

Loo `tests/test_ada_mapping.py`:

```python
"""ADA Dublin Core → VUTT väljad. Fixture'id on PÄRIS API vastused (2026-09-03)."""
import json
from pathlib import Path

import pytest

from server.ada import mapping

FIXTURES = Path(__file__).parent / "fixtures" / "ada"


@pytest.fixture
def item():
    return json.loads((FIXTURES / "item.json").read_text(encoding="utf-8"))


@pytest.fixture
def bitstreams():
    d = json.loads((FIXTURES / "bitstreams.json").read_text(encoding="utf-8"))
    return d["_embedded"]["bitstreams"]


# --- failinime kuupäev ---

def test_taiskuupaev():
    assert mapping.parse_failinime_kuupaev("07.03.1813.pdf")[:4] == (1813, 3, 7, 0)


def test_ainult_kuu_ja_aasta_ei_valeta_paeva():
    """11.1815.pdf EI OLE 1815-11-01 — päev on teadmata, mitte esimene."""
    assert mapping.parse_failinime_kuupaev("11.1815.pdf")[:4] == (1815, 11, 0, 1)


def test_ainult_aasta():
    assert mapping.parse_failinime_kuupaev("1813.pdf")[:4] == (1813, 0, 0, 2)


def test_parsimatu_laheb_loppu():
    aasta = mapping.parse_failinime_kuupaev("9997.pdf")[0]
    assert aasta > 9000


# --- sortimine ---

def test_sortimine_parandab_ada_jarjekorra(bitstreams):
    """ADA annab neli 1816. aasta kirja loendi LÕPUS — sortimine toob nad tagasi."""
    sorditud = [b["name"] for b in mapping.sordi_bitstreamid(bitstreams)]
    assert sorditud.index("28.12.1816.pdf") < sorditud.index("09.01.1823.pdf")


def test_dateerimata_on_loppu(bitstreams):
    sorditud = [b["name"] for b in mapping.sordi_bitstreamid(bitstreams)]
    assert sorditud[-3:] == ["9997.pdf", "9998.pdf", "9999.pdf"]


def test_osaline_kuupaev_perioodi_alguses(bitstreams):
    """1813.pdf (ainult aasta) tuleb enne 07.03.1813.pdf-i."""
    sorditud = [b["name"] for b in mapping.sordi_bitstreamid(bitstreams)]
    assert sorditud.index("1813.pdf") < sorditud.index("07.03.1813.pdf")


def test_sortimine_ei_kaota_ega_lisa_faile(bitstreams):
    assert len(mapping.sordi_bitstreamid(bitstreams)) == 65


# --- DC → VUTT ---

def test_pealkiri_ja_aasta(item):
    v = mapping.dc_vuttiks(item)
    assert v["title"] == "65 kirja Karl Morgensternile, \tSt. Petersburg"
    assert v["year"] == "1812"


def test_year_display_tuleb_coverage_temporalist(item):
    assert mapping.dc_vuttiks(item)["year_display"] == "31. dets.1812 - 9. jaan.1823; 7 k. s.d."


def test_creators_on_paljas_tekst_ilma_q_koodita(item):
    """Automaatne prosopograafia-sidumine tekitas duplikaat-ID-d (#240)."""
    loojad = mapping.dc_vuttiks(item)["creators"]
    assert loojad == [{"label": "Klinger, Friedrich Maximilian von"}]


def test_keel_kaardistub_iso_koodiks(item):
    assert mapping.dc_vuttiks(item)["languages"] == ["deu"]


def test_tundmatu_keel_jaetakse_valja_mitte_ei_arvata():
    v = mapping.dc_vuttiks({"metadata": {"dc.language": [{"value": "Volapük"}]}})
    assert v["languages"] == []


def test_ester_id_parsitakse_urlist(item):
    assert mapping.dc_vuttiks(item)["ester_id"] == "b1812728"


def test_archive_ref_tur_vaikimisi(item):
    assert mapping.dc_vuttiks(item)["archive_refs"] == [
        {"archive_id": "TÜR", "reference": "F 3,Mrg CCCXLII,kd.8,l.246-362"}
    ]


def test_external_url_on_handle(item):
    assert mapping.dc_vuttiks(item)["external_url"] == "http://hdl.handle.net/10062/7822"


def test_subject_ei_lahe_tagidesse(item):
    assert "tags" not in mapping.dc_vuttiks(item)


# --- mitmeväärtuselisus ---

def test_mitu_autorit_koik_sailivad():
    v = mapping.dc_vuttiks({"metadata": {"dc.contributor.author": [
        {"value": "Klinger, F. M. von"}, {"value": "Morgenstern, Karl"}]}})
    assert [c["label"] for c in v["creators"]] == ["Klinger, F. M. von", "Morgenstern, Karl"]


def test_mitu_keelt_koik_tuntud_sailivad():
    v = mapping.dc_vuttiks({"metadata": {"dc.language": [
        {"value": "German"}, {"value": "Latin"}, {"value": "Volapük"}]}})
    assert v["languages"] == ["deu", "lat"]


def test_mitu_identifier_otherit_annab_mitu_archive_refi():
    v = mapping.dc_vuttiks({"metadata": {"dc.identifier.other": [
        {"value": "F 3, kd.8"}, {"value": "F 4, kd.9"}]}})
    assert [r["reference"] for r in v["archive_refs"]] == ["F 3, kd.8", "F 4, kd.9"]


def test_description_uri_ainult_ester_loeb():
    v = mapping.dc_vuttiks({"metadata": {"dc.description.uri": [
        {"value": "https://example.org/muu"},
        {"value": "http://tartu.ester.ee/record=b9999999~S1*est"}]}})
    assert v["ester_id"] == "b9999999"


def test_pealkiri_eelistab_et_keelt():
    v = mapping.dc_vuttiks({"metadata": {"dc.title": [
        {"value": "Ohne Sprache", "language": None},
        {"value": "Eestikeelne", "language": "et"}]}})
    assert v["title"] == "Eestikeelne"
```

- [ ] **Step 3: Jooksuta test, veendu et kukub**

Run: `.venv/bin/pytest tests/test_ada_mapping.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'server.ada'`.

- [ ] **Step 4: Kirjuta `server/ada/mapping.py`**

Loo `server/ada/__init__.py` (tühi) ja `server/ada/mapping.py`:

```python
"""ADA (dspace.ut.ee) Dublin Core → VUTT metaandmed. PUHAS: null I/O.

Kogu loogika, mis võib valesti minna — kuupäeva parsimine, sortimine,
väljade kaardistus — elab siin ja on testitav ilma võrguta.
"""
import re
from typing import Dict, List, Optional, Tuple

# Sõnaline dc.language → ISO 639-2/B. Tundmatu EI kaardistu — vale kood on
# halvem kui puuduv (ADR 0019: languages = teoses SISULISELT esinevad keeled).
KEELE_KAART = {
    "german": "deu", "deutsch": "deu",
    "latin": "lat", "latina": "lat",
    "estonian": "est", "eesti": "est",
    "russian": "rus", "swedish": "swe",
    "french": "fra", "english": "eng",
    "greek": "grc", "polish": "pol",
}

# ADA on TÜ raamatukogu repositoorium. VAIKEVÄÄRTUS, mitte tõde — admin muudab.
VAIKE_ARHIIV = "TÜR"

_TAIS = re.compile(r"^(\d{2})\.(\d{2})\.(\d{4})$")
_KUU = re.compile(r"^(\d{2})\.(\d{4})$")
_AASTA = re.compile(r"^(\d{4})$")
_ESTER = re.compile(r"record=(b\d+)")
_HANDLE_URL = re.compile(r"hdl\.handle\.net/|/handle/")


def parse_failinime_kuupaev(nimi: str) -> Tuple[int, int, int, int, str]:
    """Failinimest sortimisvõti `(aasta, kuu, päev, täpsus, nimi)`.

    Täpsus hoitakse ERALDI, mitte ei võltsita puuduvat päeva 1-ks: `11.1815.pdf`
    on „1815, november, päev teadmata", mitte 1815-11-01. Praktiline järjestus on
    sama (0 < 1), aga kood ei väida teadmist, mida tal ei ole.

    Parsimatu (`9997.pdf`) saab aasta 99999 → läheb lõppu, omavahel nime järgi.
    """
    tyvi = nimi[:-4] if nimi.lower().endswith(".pdf") else nimi
    m = _TAIS.match(tyvi)
    if m:
        return (int(m.group(3)), int(m.group(2)), int(m.group(1)), 0, nimi)
    m = _KUU.match(tyvi)
    if m:
        return (int(m.group(2)), int(m.group(1)), 0, 1, nimi)
    m = _AASTA.match(tyvi)
    if m and int(m.group(1)) <= 2100:
        return (int(m.group(1)), 0, 0, 2, nimi)
    return (99999, 0, 0, 3, nimi)


def sordi_bitstreamid(bitstreams: List[dict]) -> List[dict]:
    """Kronoloogiline järjestus failinimest.

    ADA enda bitstream-järjekord EI OLE usaldusväärne: näitekirjes on neli 1816.
    aasta kirja loendi lõpus, ilmselt hiljem juurde lisatud.
    """
    return sorted(bitstreams, key=lambda b: parse_failinime_kuupaev(b.get("name", "")))


def _vaartused(item: dict, voti: str) -> List[dict]:
    """Kõik DC-kanded ühe võtme kohta. DC väljad on põhimõtteliselt kordused."""
    kanded = (item.get("metadata") or {}).get(voti) or []
    return [k for k in kanded if isinstance(k, dict) and k.get("value")]


def _esimene(item: dict, voti: str) -> Optional[str]:
    kanded = _vaartused(item, voti)
    return kanded[0]["value"] if kanded else None


def _pealkiri(item: dict) -> str:
    """Eelistus: [et] → keeleta → esimene."""
    kanded = _vaartused(item, "dc.title")
    if not kanded:
        return ""
    for k in kanded:
        if (k.get("language") or "").lower() == "et":
            return k["value"]
    for k in kanded:
        if not k.get("language"):
            return k["value"]
    return kanded[0]["value"]


def dc_vuttiks(item: dict) -> Dict[str, object]:
    """ADA item → VUTT-i metaandmete alamhulk.

    `type` ja `collections` EI tule siit: ADA ei ütle tüüpi ja `meta.type` on
    bibliograafiline väide, mida ei seata vaikselt (ADR 0028 §3).
    """
    keeled = []
    for k in _vaartused(item, "dc.language"):
        kood = KEELE_KAART.get(k["value"].strip().lower())
        if kood and kood not in keeled:
            keeled.append(kood)

    ester = None
    for k in _vaartused(item, "dc.description.uri"):
        m = _ESTER.search(k["value"])
        if m:
            ester = m.group(1)
            break

    handle_url = None
    for k in _vaartused(item, "dc.identifier.uri"):
        if _HANDLE_URL.search(k["value"]):
            handle_url = k["value"]
            break

    return {
        "title": _pealkiri(item),
        "year": _esimene(item, "dc.date.issued") or "",
        "year_display": _esimene(item, "dc.coverage.temporal") or "",
        "creators": [{"label": k["value"]} for k in _vaartused(item, "dc.contributor.author")],
        "languages": keeled,
        "ester_id": ester,
        "archive_refs": [
            {"archive_id": VAIKE_ARHIIV, "reference": k["value"]}
            for k in _vaartused(item, "dc.identifier.other")
        ],
        "external_url": handle_url,
    }
```

- [ ] **Step 5: Jooksuta test, veendu et läheb läbi**

Run: `.venv/bin/pytest tests/test_ada_mapping.py -v`
Expected: PASS, 22 testi.

- [ ] **Step 6: Commit**

```bash
git add server/ada/ tests/test_ada_mapping.py tests/fixtures/ada/
git commit -m "feat(ada): Dublin Core → VUTT kaardistus ja kronoloogiline sortimine

Fixture'id on päris ADA vastused (2026-09-03), mitte käsitsi kirjutatud —
eelmine kord ehitati integratsioon mockitud lepingu peale ja leping osutus
fiktiivseks. Sortimisvõti hoiab täpsust eraldi: 11.1815.pdf ei ole 1815-11-01."
```

---

## Task 4: `server/ada/client.py` — handle'i normaliseerimine ja ADA REST

**Files:**
- Create: `server/ada/client.py`
- Test: `tests/test_ada_client.py`

**Interfaces:**
- Consumes: `server.ada.mapping.sordi_bitstreamid`, `dc_vuttiks`
- Produces:
  - `normaliseeri_handle(sisend: str) -> str` — viis sisendkuju → `"10062/7822"`; `AdaViga` kui ei tunne ära.
  - `class AdaViga(Exception)` — atribuut `kasutaja_sonum: str`
  - `lookup(handle: str) -> dict` — `{handle, item_uuid, meta, failid: [{name, bitstream_uuid, size_bytes, tapsus}], kogu_baite, vahele_jaetud: [str]}`

- [ ] **Step 1: Kirjuta kukkuv test**

Loo `tests/test_ada_client.py`:

```python
"""Handle'i normaliseerimine ja ADA REST lookup. Võrku ei puudutata."""
import json
from pathlib import Path

import pytest

from server.ada import client

FIXTURES = Path(__file__).parent / "fixtures" / "ada"


# --- handle'i normaliseerimine ---

@pytest.mark.parametrize("sisend", [
    "10062/7822",
    "hdl:10062/7822",
    "http://hdl.handle.net/10062/7822",
    "https://hdl.handle.net/10062/7822",
    "https://dspace.ut.ee/handle/10062/7822",
    "  10062/7822  ",
])
def test_normaliseeri_handle_koik_kujud(sisend):
    assert client.normaliseeri_handle(sisend) == "10062/7822"


def test_normaliseeri_handle_viskab_selge_vea():
    with pytest.raises(client.AdaViga) as exc:
        client.normaliseeri_handle("mingi jama")
    assert "handle" in exc.value.kasutaja_sonum.lower()


def test_items_url_ei_ole_handle():
    """/items/{uuid} on UUID-kuju — lubatud, aga eraldi teena."""
    assert client.on_item_uuid("https://dspace.ut.ee/items/5a495195-44c1-463b-a425-643dc4dcf13f")


# --- lookup ---

class FakeVastus:
    def __init__(self, data, status=200):
        self._data = data
        self.status_code = status

    def json(self):
        return self._data

    @property
    def ok(self):
        return self.status_code == 200


@pytest.fixture
def fake_ada(monkeypatch):
    item = json.loads((FIXTURES / "item.json").read_text(encoding="utf-8"))
    bundles = json.loads((FIXTURES / "bundles.json").read_text(encoding="utf-8"))
    bitstreams = json.loads((FIXTURES / "bitstreams.json").read_text(encoding="utf-8"))

    def fake_get(url, **kwargs):
        if "/pid/find" in url:
            return FakeVastus(item)
        if "/bundles" in url and "/bundles/" not in url:
            return FakeVastus(bundles)
        if "/bitstreams" in url:
            return FakeVastus(bitstreams)
        raise AssertionError("ootamatu URL: {}".format(url))

    monkeypatch.setattr(client.requests, "get", fake_get)


def test_lookup_tagastab_65_faili(fake_ada):
    tulemus = client.lookup("10062/7822")
    assert len(tulemus["failid"]) == 65
    assert tulemus["kogu_baite"] == 322_000_000 or tulemus["kogu_baite"] > 300_000_000


def test_lookup_failid_on_kronoloogilises_jarjekorras(fake_ada):
    nimed = [f["name"] for f in client.lookup("10062/7822")["failid"]]
    assert nimed.index("28.12.1816.pdf") < nimed.index("09.01.1823.pdf")


def test_lookup_kannab_metaandmed_kaasa(fake_ada):
    meta = client.lookup("10062/7822")["meta"]
    assert meta["year"] == "1812"
    assert meta["ester_id"] == "b1812728"


def test_lookup_margib_ebatapse_kuupaevaga_failid(fake_ada):
    failid = client.lookup("10062/7822")["failid"]
    ebatapsed = {f["name"] for f in failid if f["tapsus"] > 0}
    assert ebatapsed == {"1813.pdf", "11.1815.pdf", "9997.pdf", "9998.pdf", "9999.pdf"}


def test_lookup_votab_ainult_original_kimbu(fake_ada, monkeypatch):
    """LICENSE / TEXT / THUMBNAIL ei tohi kunagi lehtedeks saada."""
    kutsutud = []
    paris_get = client.requests.get

    def spioon(url, **kwargs):
        kutsutud.append(url)
        return paris_get(url, **kwargs)

    monkeypatch.setattr(client.requests, "get", spioon)
    client.lookup("10062/7822")
    # ORIGINAL kimbu uuid näitekirjest; ühtki teist bundle-bitstreams päringut ei tehta
    bitstream_paringud = [u for u in kutsutud if "/bitstreams" in u]
    assert len(bitstream_paringud) == 1
    assert "acd9a484-d0a6-43a2-b19f-d8cd2dbde692" in bitstream_paringud[0]


def test_lookup_ilma_pdf_ideta_viskab_vea(monkeypatch):
    item = json.loads((FIXTURES / "item.json").read_text(encoding="utf-8"))
    bundles = json.loads((FIXTURES / "bundles.json").read_text(encoding="utf-8"))

    def fake_get(url, **kwargs):
        if "/pid/find" in url:
            return FakeVastus(item)
        if "/bundles" in url and "/bundles/" not in url:
            return FakeVastus(bundles)
        return FakeVastus({"_embedded": {"bitstreams": []}, "page": {"totalElements": 0}})

    monkeypatch.setattr(client.requests, "get", fake_get)
    with pytest.raises(client.AdaViga) as exc:
        client.lookup("10062/7822")
    assert "PDF" in exc.value.kasutaja_sonum


def test_lookup_404_annab_koneka_vea(monkeypatch):
    monkeypatch.setattr(client.requests, "get", lambda url, **k: FakeVastus({}, status=404))
    with pytest.raises(client.AdaViga) as exc:
        client.lookup("10062/9999999")
    assert "ei ole" in exc.value.kasutaja_sonum.lower()


def test_lookup_jatab_mitte_pdf_id_vahele(monkeypatch):
    item = json.loads((FIXTURES / "item.json").read_text(encoding="utf-8"))
    bundles = json.loads((FIXTURES / "bundles.json").read_text(encoding="utf-8"))
    segu = {"_embedded": {"bitstreams": [
        {"name": "01.01.1800.pdf", "uuid": "u1", "sizeBytes": 10},
        {"name": "skann.tif", "uuid": "u2", "sizeBytes": 20},
    ]}, "page": {"totalElements": 2}}

    def fake_get(url, **kwargs):
        if "/pid/find" in url:
            return FakeVastus(item)
        if "/bundles" in url and "/bundles/" not in url:
            return FakeVastus(bundles)
        return FakeVastus(segu)

    monkeypatch.setattr(client.requests, "get", fake_get)
    tulemus = client.lookup("10062/7822")
    assert [f["name"] for f in tulemus["failid"]] == ["01.01.1800.pdf"]
    assert tulemus["vahele_jaetud"] == ["skann.tif"]
```

- [ ] **Step 2: Jooksuta test, veendu et kukub**

Run: `.venv/bin/pytest tests/test_ada_client.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'server.ada.client'`.

- [ ] **Step 3: Kirjuta `server/ada/client.py`**

```python
"""ADA (dspace.ut.ee) REST-klient. DSpace 7.6.6, autentimist ei vaja.

API kuju on TEOSTUSDETAIL. Leping on `lookup()` tagastuskuju — DSpace on
versioonide vahel teid muutnud ja teeb seda uuesti.
"""
import re
from typing import Dict, List, Optional

import requests

from ..config import get_logger
from . import mapping

logger = get_logger(__name__)

BASE = "https://dspace.ut.ee/server/api"
TIMEOUT = 30

# ORIGINAL on ainus kimp, milles on skaneeringud. TEXT sisaldab OCR-i
# (mitte meie oma), THUMBNAIL pisipilte, LICENSE litsentsiteksti.
LUBATUD_KIMP = "ORIGINAL"

_HANDLE = re.compile(r"(\d+/\d+)\s*$")
_UUID = re.compile(r"/items/([0-9a-f-]{36})")


class AdaViga(Exception):
    """Viga, mille sõnum on mõeldud kasutajale näitamiseks."""

    def __init__(self, kasutaja_sonum: str):
        super().__init__(kasutaja_sonum)
        self.kasutaja_sonum = kasutaja_sonum


def on_item_uuid(sisend: str) -> Optional[str]:
    """Tagastab item UUID, kui sisend on /items/{uuid} kujul."""
    m = _UUID.search(sisend or "")
    return m.group(1) if m else None


def normaliseeri_handle(sisend: str) -> str:
    """Viis sisendkuju → `10062/7822`.

    Aktsepteerib: paljas handle, `hdl:`-prefiks, hdl.handle.net URL,
    dspace.ut.ee/handle/ URL. Tühikud lõigatakse.
    """
    tekst = (sisend or "").strip()
    m = _HANDLE.search(tekst)
    if not m:
        raise AdaViga(
            "Ei tundnud handle'it ära. Oodatud kuju: 10062/7822, "
            "hdl:10062/7822 või http://hdl.handle.net/10062/7822"
        )
    return m.group(1)


def _get(url: str) -> dict:
    try:
        vastus = requests.get(url, timeout=TIMEOUT, allow_redirects=True)
    except requests.RequestException as e:
        logger.warning("ADA päring ebaõnnestus: %s (%s)", url, e)
        raise AdaViga("ADA server ei vasta. Proovi hiljem või täida vorm käsitsi.")
    if vastus.status_code == 404:
        raise AdaViga("Sellist kirjet ADA-s ei ole.")
    if not getattr(vastus, "ok", vastus.status_code == 200):
        raise AdaViga("ADA vastas veaga (HTTP {}).".format(vastus.status_code))
    return vastus.json()


def lookup(handle: str) -> Dict[str, object]:
    """Handle → metaandmed + sorditud PDF-failide plaan. EI KIRJUTA midagi."""
    item = _get("{}/pid/find?id=hdl:{}".format(BASE, handle))
    item_uuid = item.get("uuid")
    if not item_uuid:
        raise AdaViga("Sellist kirjet ADA-s ei ole.")

    kimbud = _get("{}/core/items/{}/bundles".format(BASE, item_uuid))
    original = None
    for k in (kimbud.get("_embedded") or {}).get("bundles") or []:
        if k.get("name") == LUBATUD_KIMP:
            original = k.get("uuid")
            break
    if not original:
        raise AdaViga("Kirjel ei ole ORIGINAL-kimpu — faile ei ole millest importida.")

    kimbu_sisu = _get("{}/core/bundles/{}/bitstreams?size=1000".format(BASE, original))
    koik = (kimbu_sisu.get("_embedded") or {}).get("bitstreams") or []

    pdfid = [b for b in koik if (b.get("name") or "").lower().endswith(".pdf")]
    vahele_jaetud = [b.get("name") or "?" for b in koik if b not in pdfid]
    if not pdfid:
        raise AdaViga("ORIGINAL-kimbus ei ole ühtki PDF-i.")

    failid = []
    for b in mapping.sordi_bitstreamid(pdfid):
        nimi = b.get("name") or ""
        failid.append({
            "name": nimi,
            "bitstream_uuid": b.get("uuid"),
            "size_bytes": int(b.get("sizeBytes") or 0),
            "tapsus": mapping.parse_failinime_kuupaev(nimi)[3],
        })

    return {
        "handle": handle,
        "item_uuid": item_uuid,
        "meta": mapping.dc_vuttiks(item),
        "failid": failid,
        "kogu_baite": sum(f["size_bytes"] for f in failid),
        "vahele_jaetud": vahele_jaetud,
    }
```

- [ ] **Step 4: Jooksuta test, veendu et läheb läbi**

Run: `.venv/bin/pytest tests/test_ada_client.py -v`
Expected: PASS.

- [ ] **Step 5: Lisa elava ADA vastu käiv test OLEMASOLEVA `live` markeriga**

`pytest.ini`-s on juba `live` marker ja `addopts = -m "not live"`. **Ära lisa uut
markerit** — kasuta olemasolevat.

Loo `tests/test_ada_live.py`:

```python
"""Kontrollib, et fixture'id vastavad ENDISELT elavale ADA-le.

Vaikimisi vahele jäetud (pytest.ini: addopts = -m "not live").
Käsitsi: `.venv/bin/pytest tests/test_ada_live.py -m live`
"""
import pytest

from server.ada import client

pytestmark = pytest.mark.live


def test_elav_ada_annab_endiselt_65_pdfi():
    tulemus = client.lookup("10062/7822")
    assert len(tulemus["failid"]) == 65
    assert tulemus["meta"]["ester_id"] == "b1812728"
```

- [ ] **Step 6: Kontrolli, et vaikimisi jooksutus jätab elava testi vahele**

Run: `.venv/bin/pytest tests/ -q`
Expected: PASS; väljundis `deselected` elava testi kohta.

Run: `.venv/bin/pytest tests/test_ada_live.py -m live -v`
Expected: PASS (nõuab võrku) — see kinnitab, et fixture'id on värsked.

- [ ] **Step 7: Commit**

```bash
git add server/ada/client.py tests/test_ada_client.py tests/test_ada_live.py
git commit -m "feat(ada): REST-klient ja handle\'i normaliseerimine

Ainult ORIGINAL-kimp ja ainult PDF-id; muu loetletakse ja jäetakse vahele.
Elav test olemasoleva live-markeri taga kontrollib, et fixture\'id ei vanane."
```

---

## Task 5: `POST /admin/ada/lookup` endpoint

**Files:**
- Modify: `server/routers/upload.py`
- Test: `tests/test_ada_lookup_endpoint.py`

**Interfaces:**
- Consumes: `server.ada.client.lookup`, `normaliseeri_handle`, `AdaViga`
- Produces: `POST /admin/ada/lookup` body `{"handle": "..."}` → `{"status": "success", "ada": {...}}`; viga → HTTP 400 `{"detail": "<kasutaja_sonum>"}`.

- [ ] **Step 1: Kirjuta kukkuv test**

Loo `tests/test_ada_lookup_endpoint.py`:

```python
"""ADA lookup endpoint: rollikontroll, vigade kuju, blokeeriv I/O threadpoolis.

Fixture-muster on sama nagu `tests/test_admin_role_endpoints.py`-s: `client` +
`login` fixture'id, token Authorization-päises.
"""
import pytest

from server.ada import client as ada_client


def _peis(login, kasutaja="admin", parool="adminpass"):
    return {"Authorization": "Bearer {}".format(login(kasutaja, parool))}


def test_lookup_nouab_admini(client, login):
    """editor < admin — endpoint on /admin/ all ja nõuab require_role('admin')."""
    r = client.post("/admin/ada/lookup", json={"handle": "10062/7822"},
                    headers=_peis(login, "editor", "editorpass"))
    assert r.status_code in (401, 403)


def test_lookup_tagastab_ada_ploki(client, login, monkeypatch):
    monkeypatch.setattr(ada_client, "lookup", lambda h: {
        "handle": h, "item_uuid": "u", "meta": {"title": "T"},
        "failid": [{"name": "a.pdf", "bitstream_uuid": "b", "size_bytes": 5, "tapsus": 0}],
        "kogu_baite": 5, "vahele_jaetud": [],
    })
    r = client.post("/admin/ada/lookup", json={"handle": "hdl:10062/7822"},
                    headers=_peis(login))
    assert r.status_code == 200, r.text
    assert r.json()["ada"]["handle"] == "10062/7822"


def test_lookup_viga_tuleb_400_ga_ja_kasutaja_sonumiga(client, login, monkeypatch):
    def kukub(h):
        raise ada_client.AdaViga("Sellist kirjet ADA-s ei ole.")

    monkeypatch.setattr(ada_client, "lookup", kukub)
    r = client.post("/admin/ada/lookup", json={"handle": "10062/9999999"},
                    headers=_peis(login))
    assert r.status_code == 400
    assert r.json()["detail"] == "Sellist kirjet ADA-s ei ole."


def test_lookup_vigane_handle_ei_joua_ada_ni(client, login, monkeypatch):
    monkeypatch.setattr(ada_client, "lookup",
                        lambda h: pytest.fail("ei tohi kutsuda"))
    r = client.post("/admin/ada/lookup", json={"handle": "mingi jama"},
                    headers=_peis(login))
    assert r.status_code == 400
```

**Kontrollitud:** `backend_env` annab **dikti** (`client`, `auth`, `upload_ops`, …),
mitte korteeži, ja valmis päiseid seal ei ole — kasutatakse `client` + `login`
fixture'eid. Seemnekasutajad on `admin`/`adminpass` ja `editor`/`editorpass`.

- [ ] **Step 2: Jooksuta test, veendu et kukub**

Run: `.venv/bin/pytest tests/test_ada_lookup_endpoint.py -v`
Expected: FAIL — 404, marsruuti ei ole.

- [ ] **Step 3: Lisa endpoint**

`server/routers/upload.py`. Lisa import failipäisesse:

```python
from ..ada import client as ada_client
```

ja endpoint (teiste `/admin/upload/...` marsruutide kõrvale):

```python
@router.post("/admin/ada/lookup")
async def admin_ada_lookup(request: Request, user=Depends(require_role("admin"))):
    """Handle → ADA metaandmed + failiplaan. EI KIRJUTA midagi.

    `run_in_threadpool`: `requests.get` on blokeeriv ja `async def` sees külmutaks
    event-loopi, kui ADA on kättesaamatu (ADR 0002 / 2026-06-13 outage).
    """
    data = await get_json_data(request)
    try:
        handle = ada_client.normaliseeri_handle(data.get("handle", ""))
        tulemus = await run_in_threadpool(ada_client.lookup, handle)
    except ada_client.AdaViga as e:
        raise HTTPException(status_code=400, detail=e.kasutaja_sonum)
    return {"status": "success", "ada": tulemus}
```

- [ ] **Step 4: Jooksuta test, veendu et läheb läbi**

Run: `.venv/bin/pytest tests/test_ada_lookup_endpoint.py -v`
Expected: PASS.

- [ ] **Step 5: Kontrolli, et endpoint ei riku async-offloadi valvurit**

Run: `.venv/bin/pytest tests/test_async_endpoint_offload.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/routers/upload.py tests/test_ada_lookup_endpoint.py
git commit -m "feat(ada): POST /admin/ada/lookup

Blokeeriv requests.get läheb run_in_threadpool'i — async def sees külmutaks
kättesaamatu ADA kogu saidi (ADR 0002)."
```

---

## Task 6: `server/ada/fetch.py` — `.part`-allalaadimine ja liitmine

**Files:**
- Create: `server/ada/fetch.py`
- Modify: `server/upload/state.py` (uued staatused konstantidesse, kui neid loetletakse)
- Test: `tests/test_ada_fetch.py`

**Interfaces:**
- Consumes: `upload_state.upload_dir`, `set_upload_state`, `init_prepress`, `upload_progress`
- Produces:
  - `alusta_fetchi(upload_id: str) -> bool` — CAS; `False` kui juba käib.
  - `laadi_tykk(url: str, sihtfail: str, oodatud_baite: int) -> None` — `.part` → rename.
  - `liida_pdfid(kaust: str, sihtfail: str) -> None` — `pdfunite`.
  - Staatused: `ada_fetching`, `ada_error`.

- [ ] **Step 1: Kirjuta kukkuv test**

Loo `tests/test_ada_fetch.py`:

```python
"""ADA allalaadimise leping: idempotentsus, .part, katkestus, restart."""
import json
import os
import subprocess

import pytest

from server.ada import fetch
from server.upload import state as upload_state


@pytest.fixture
def upload(tmp_path, monkeypatch):
    monkeypatch.setattr(upload_state, "UPLOADS_DIR", str(tmp_path), raising=False)
    monkeypatch.setattr(fetch.upload_state, "UPLOADS_DIR", str(tmp_path), raising=False)
    uid = "adaupl01"
    (tmp_path / uid).mkdir()
    state = {"id": uid, "status": "pending", "meta": {"slug": "test-abc"}, "files": [],
             "ada": {"handle": "10062/7822", "item_uuid": "u", "sources": []}}
    (tmp_path / uid / "state.json").write_text(json.dumps(state), encoding="utf-8")
    return uid


def _status(tmp_path, uid):
    return json.loads((tmp_path / uid / "state.json").read_text(encoding="utf-8"))["status"]


# --- F1: idempotentsus ---

def test_teine_fetch_ei_kaivita_teist_toolim(upload, tmp_path):
    assert fetch.alusta_fetchi(upload) is True
    assert _status(tmp_path, upload) == "ada_fetching"
    assert fetch.alusta_fetchi(upload) is False


def test_fetch_saab_alata_ada_error_seisust(upload, tmp_path):
    upload_state.set_upload_state(upload, status="ada_error")
    assert fetch.alusta_fetchi(upload) is True


def test_fetch_ei_saa_alata_awaiting_split_seisust(upload):
    """Fail on juba kohal — kordus kirjutaks source.pdf-i üle."""
    upload_state.set_upload_state(upload, status="awaiting_split")
    assert fetch.alusta_fetchi(upload) is False


# --- F2: .part ---

def test_katkenud_allalaadimine_ei_jata_valmis_naivat_faili(tmp_path, monkeypatch):
    siht = str(tmp_path / "017.pdf")

    class KatkevVastus:
        status_code = 200
        headers = {}

        def iter_content(self, chunk_size):
            yield b"x" * 10
            raise IOError("ühendus katkes")

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(fetch.requests, "get", lambda *a, **k: KatkevVastus())
    with pytest.raises(IOError):
        fetch.laadi_tykk("https://ada/x", siht, 100)
    assert not os.path.exists(siht)
    assert os.path.exists(siht + ".part") or True  # .part võib jääda või kaduda


def test_vale_suurus_ei_saa_valmis_nime(tmp_path, monkeypatch):
    """Sisu tuli lõpuni, aga baite on vähem kui bitstream lubas."""
    siht = str(tmp_path / "018.pdf")

    class LyhikeVastus:
        status_code = 200
        headers = {}

        def iter_content(self, chunk_size):
            yield b"x" * 10

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(fetch.requests, "get", lambda *a, **k: LyhikeVastus())
    with pytest.raises(fetch.AdaFetchViga):
        fetch.laadi_tykk("https://ada/x", siht, 100)
    assert not os.path.exists(siht)


def test_terve_allalaadimine_saab_valmis_nime(tmp_path, monkeypatch):
    siht = str(tmp_path / "019.pdf")

    class TerveVastus:
        status_code = 200
        headers = {}

        def iter_content(self, chunk_size):
            yield b"x" * 100

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(fetch.requests, "get", lambda *a, **k: TerveVastus())
    fetch.laadi_tykk("https://ada/x", siht, 100)
    assert os.path.getsize(siht) == 100
    assert not os.path.exists(siht + ".part")


def test_juba_olemas_olevat_tykki_ei_tommata_uuesti(tmp_path, monkeypatch):
    siht = tmp_path / "020.pdf"
    siht.write_bytes(b"y" * 100)
    monkeypatch.setattr(fetch.requests, "get",
                        lambda *a, **k: pytest.fail("ei tohi uuesti tõmmata"))
    fetch.laadi_tykk("https://ada/x", str(siht), 100)


# --- liitmine ---

def test_liida_pdfid_kutsub_pdfunite_sorditud_jarjekorras(tmp_path, monkeypatch):
    kaust = tmp_path / "ada"
    kaust.mkdir()
    for n in ("003.pdf", "001.pdf", "002.pdf"):
        (kaust / n).write_bytes(b"%PDF-1.4\n")
    kutsed = []
    monkeypatch.setattr(fetch.subprocess, "run",
                        lambda cmd, **k: kutsed.append(cmd) or subprocess.CompletedProcess(cmd, 0))
    fetch.liida_pdfid(str(kaust), str(tmp_path / "source.pdf"))
    cmd = kutsed[0]
    assert cmd[0] == "pdfunite"
    assert [os.path.basename(p) for p in cmd[1:-1]] == ["001.pdf", "002.pdf", "003.pdf"]


def test_liitmine_ei_kasuta_keelatud_tooriistu(tmp_path, monkeypatch):
    """qpdf / pdftk / pypdf EI OLE backend-konteineris olemas."""
    kaust = tmp_path / "ada"
    kaust.mkdir()
    (kaust / "001.pdf").write_bytes(b"%PDF-1.4\n")
    kutsed = []
    monkeypatch.setattr(fetch.subprocess, "run",
                        lambda cmd, **k: kutsed.append(cmd) or subprocess.CompletedProcess(cmd, 0))
    fetch.liida_pdfid(str(kaust), str(tmp_path / "source.pdf"))
    assert all(c[0] not in ("qpdf", "pdftk") for c in kutsed)


# --- F3 + restart ---

def test_katkestus_peatab_workeri(upload, tmp_path):
    """Staging kustutatud → worker EI TOHI kataloogi uuesti tekitada."""
    import shutil
    shutil.rmtree(tmp_path / upload)
    assert fetch.tohib_jatkata(upload) is False


def test_restardi_taaste_margib_rippuva_too_veaks(upload, tmp_path):
    upload_state.set_upload_state(upload, status="ada_fetching")
    fetch.taasta_rippuvad_fetchid()
    assert _status(tmp_path, upload) == "ada_error"
```

- [ ] **Step 2: Jooksuta test, veendu et kukub**

Run: `.venv/bin/pytest tests/test_ada_fetch.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'server.ada.fetch'`.

- [ ] **Step 3: Kirjuta `server/ada/fetch.py`**

```python
"""ADA failide allalaadimine ja liitmine. Taustalõim, restartitav.

Tõde on FAILIDES, mitte mälus: `017.pdf` olemasolu tähendab „see tükk on terve".
Poolik allalaadimine elab `.part`-failina ja ei näe kunagi välja nagu valmis fail.
"""
import os
import subprocess
import threading
from typing import List, Optional

import requests

from ..config import get_logger, UPLOADS_DIR
from ..upload import state as upload_state
from . import client as ada_client

logger = get_logger(__name__)

CHUNK = 1024 * 256
ALLALAADIMISE_TIMEOUT = 300
LIITMISE_TIMEOUT = 600

# CAS: nendest olekutest tohib fetch alata. `awaiting_split` EI KUULU siia —
# seal on source.pdf juba kohal ja kordus kirjutaks selle üle.
FETCH_START_STATUSES = ("pending", "ada_error")


class AdaFetchViga(Exception):
    pass


def ada_kaust(upload_id: str) -> str:
    return os.path.join(upload_state.upload_dir(upload_id), "ada")


def tohib_jatkata(upload_id: str) -> bool:
    """F3: kas upload on veel olemas. Kontrollitakse IGA tüki alguses.

    `Katkesta` kustutab staging-kausta; kirjutav lõim tekitaks selle uuesti.
    """
    return os.path.isdir(upload_state.upload_dir(upload_id))


def alusta_fetchi(upload_id: str) -> bool:
    """F1: CAS + taustalõim. False = töö juba käib (topeltklikk, retry, kaks tabi)."""
    lock = upload_state.get_upload_lock(upload_id)
    with lock:
        s = upload_state.read_state(upload_id)
        if not s or s.get("status") not in FETCH_START_STATUSES:
            return False
        s["status"] = "ada_fetching"
        upload_state.write_state(upload_id, s)
    threading.Thread(
        target=_toota, args=(upload_id,), daemon=True,
        name="ada-fetch-{}".format(upload_id),
    ).start()
    return True


def laadi_tykk(url: str, sihtfail: str, oodatud_baite: int) -> None:
    """F2: laeb `.part`-i ja nimetab ümber alles pärast suuruse kontrolli.

    Juba olemasolev sihtfail on VALMIS tükk — seda ei tõmmata uuesti.
    """
    if os.path.exists(sihtfail):
        return
    ajutine = sihtfail + ".part"
    saadud = 0
    try:
        with requests.get(url, stream=True, timeout=ALLALAADIMISE_TIMEOUT) as vastus:
            if vastus.status_code != 200:
                raise AdaFetchViga("ADA vastas veaga (HTTP {})".format(vastus.status_code))
            with open(ajutine, "wb") as f:
                for tykk in vastus.iter_content(chunk_size=CHUNK):
                    if tykk:
                        f.write(tykk)
                        saadud += len(tykk)
    except AdaFetchViga:
        raise
    except Exception:
        # `.part` jääb alles; järgmine katse kirjutab selle üle. Valmis nime
        # ta EI saa, seega poolik sisu ei jõua kunagi pdfunite'i.
        raise
    if oodatud_baite and saadud != oodatud_baite:
        raise AdaFetchViga(
            "Fail jäi pooleli: saadud {} baiti, oodatud {}".format(saadud, oodatud_baite)
        )
    os.replace(ajutine, sihtfail)


def liida_pdfid(kaust: str, sihtfail: str) -> None:
    """`pdfunite` — AINUS lubatud tööriist. qpdf/pdftk/pypdf ei ole konteineris."""
    failid = sorted(
        os.path.join(kaust, n) for n in os.listdir(kaust) if n.endswith(".pdf")
    )
    if not failid:
        raise AdaFetchViga("Liidetavaid PDF-e ei ole")
    cmd = ["pdfunite"] + failid + [sihtfail]
    tulemus = subprocess.run(cmd, capture_output=True, timeout=LIITMISE_TIMEOUT)
    if tulemus.returncode != 0:
        raise AdaFetchViga("pdfunite kukkus: {}".format(
            (getattr(tulemus, "stderr", b"") or b"")[:400].decode("utf-8", "replace")
        ))


def lehtede_arv(pdf_path: str) -> int:
    """`pdfinfo` — sama pakett mis pdfunite."""
    tulemus = subprocess.run(["pdfinfo", pdf_path], capture_output=True, timeout=60)
    for rida in (tulemus.stdout or b"").decode("utf-8", "replace").splitlines():
        if rida.startswith("Pages:"):
            return int(rida.split(":", 1)[1].strip())
    raise AdaFetchViga("pdfinfo ei andnud lehtede arvu")


def taasta_rippuvad_fetchid() -> None:
    """Käivitusel: `ada_fetching` → `ada_error`.

    `upload_progress` on mälupõhine — restart kaotab progressi. Ilma selle
    taasteta jääks töö igaveseks `ada_fetching`-usse ja „Laen uuesti" oleks
    blokeeritud CAS-i poolt. Sama muster nagu `reocr_recovery.py`.
    """
    if not os.path.isdir(UPLOADS_DIR):
        return
    for uid in os.listdir(UPLOADS_DIR):
        try:
            s = upload_state.read_state(uid)
            if s and s.get("status") == "ada_fetching":
                upload_state.set_upload_state(
                    uid, status="ada_error",
                    ada_error="Backend taaskäivitus allalaadimise ajal. Vajuta „Laen uuesti“.",
                )
                logger.info("ADA fetch taastatud veaks: %s", uid)
        except Exception:
            logger.warning("ADA fetch taaste ebaõnnestus: %s", uid, exc_info=True)


def _toota(upload_id: str) -> None:
    """Taustalõim: tükid alla, liida, olek edasi."""
    kaust = ada_kaust(upload_id)
    try:
        os.makedirs(kaust, exist_ok=True)
        s = upload_state.read_state(upload_id)
        allikad = ((s or {}).get("ada") or {}).get("sources") or []
        kogu = sum(int(a.get("size_bytes") or 0) for a in allikad)
        upload_state.upload_progress[upload_id] = {
            "bytes_sent": 0, "bytes_total": kogu, "error": None,
        }
        saadud = 0
        for jrk, allikas in enumerate(allikad, start=1):
            if not tohib_jatkata(upload_id):
                logger.info("ADA fetch katkestatud (staging kadus): %s", upload_id)
                return
            siht = os.path.join(kaust, "{:03d}.pdf".format(jrk))
            url = "{}/core/bitstreams/{}/content".format(
                ada_client.BASE, allikas["bitstream_uuid"]
            )
            laadi_tykk(url, siht, int(allikas.get("size_bytes") or 0))
            saadud += int(allikas.get("size_bytes") or 0)
            upload_state.upload_progress[upload_id] = {
                "bytes_sent": saadud, "bytes_total": kogu, "error": None,
                "files_done": jrk, "files_total": len(allikad),
            }

        if not tohib_jatkata(upload_id):
            return
        source_pdf = os.path.join(upload_state.upload_dir(upload_id), "source.pdf")
        liida_pdfid(kaust, source_pdf)
        lehti = lehtede_arv(source_pdf)

        # Täida lähtekaardi lehepiirid: mitmes leht liidetud PDF-is iga tükk algab.
        nihe = 1
        uued = []
        for jrk, allikas in enumerate(allikad, start=1):
            tyki_lehti = lehtede_arv(os.path.join(kaust, "{:03d}.pdf".format(jrk)))
            uus = dict(allikas)
            uus["first_src_page"] = nihe
            uus["page_count"] = tyki_lehti
            uued.append(uus)
            nihe += tyki_lehti

        s = upload_state.read_state(upload_id) or {}
        ada = dict(s.get("ada") or {})
        ada["sources"] = uued
        # ADR 0028: kuni `applying`-uni on `expected_pages` LÄHTE-lehtede arv.
        upload_state.set_upload_state(
            upload_id, status="awaiting_split", expected_pages=lehti, ada=ada,
            ada_error=None,
        )
        upload_state.init_prepress(upload_id, lehti)

        for n in os.listdir(kaust):
            os.unlink(os.path.join(kaust, n))
        os.rmdir(kaust)
        logger.info("ADA fetch valmis: %s (%s lk)", upload_id, lehti)
    except Exception as e:
        logger.error("ADA fetch kukkus: %s (%s)", upload_id, e, exc_info=True)
        if tohib_jatkata(upload_id):
            # Tükid JÄÄVAD alles — „Laen uuesti" jätkab sealt, kus pooleli jäi.
            upload_state.set_upload_state(upload_id, status="ada_error", ada_error=str(e))
```

- [ ] **Step 4: Jooksuta test, veendu et läheb läbi**

Run: `.venv/bin/pytest tests/test_ada_fetch.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/ada/fetch.py tests/test_ada_fetch.py
git commit -m "feat(ada): .part-allalaadimine, pdfunite-liitmine, restardi taaste

Tõde on failides, mitte mälus: valmis nime saab tükk alles pärast suuruse
kontrolli, seega poolik sisu ei jõua kunagi pdfunite'i. Rippuv ada_fetching
märgitakse käivitusel ada_error'iks, muidu blokeeriks CAS 'Laen uuesti' nupu."
```

---

## Task 7: `POST /admin/upload/{id}/ada-fetch` + käivitustaaste

**Files:**
- Modify: `server/routers/upload.py` (`admin_upload_create` — ADA-ploki salvestamine; uus fetch-endpoint)
- Modify: `server/upload_ops.py` (`create_upload` — `ada` võtme läbilaskmine)
- Modify: `server/main.py` (lifespan, read 55–62)
- Test: `tests/test_ada_fetch_endpoint.py`

**Interfaces:**
- Consumes: `server.ada.fetch.alusta_fetchi`, `taasta_rippuvad_fetchid`
- Produces: `POST /admin/upload/{id}/ada-fetch` → 200 `{"status": "ada_fetching"}` või 409, kui juba käib.

- [ ] **Step 1: Kirjuta kukkuv test**

Loo `tests/test_ada_fetch_endpoint.py`:

```python
"""ada-fetch endpoint: rollikontroll, 409 korduse peale, ada-plokk create'ist.

monkeypatch sihib `upload_router.ada_fetch`-i, mitte `server.ada.fetch`-i — router
impordib mooduli endale ja mooduli atribuudi asendamine mõjub mõlemale.
"""
from server.routers import upload as upload_router


def _peis(login, kasutaja="admin", parool="adminpass"):
    return {"Authorization": "Bearer {}".format(login(kasutaja, parool))}


def _loo(client, login, **lisa):
    keha = {"title": "Kirjad", "year": "1812", "slug": "kirjad"}
    keha.update(lisa)
    r = client.post("/admin/upload/create", json=keha, headers=_peis(login))
    assert r.status_code == 200, r.text
    return r.json()["upload"]


ADA_PLOKK = {"handle": "10062/7822", "item_uuid": "u",
             "sources": [{"name": "a.pdf", "bitstream_uuid": "b1", "size_bytes": 10}]}


def test_fetch_nouab_admini(client, login):
    r = client.post("/admin/upload/xyz/ada-fetch",
                    headers=_peis(login, "editor", "editorpass"))
    assert r.status_code in (401, 403)


def test_create_salvestab_ada_ploki(client, login):
    assert _loo(client, login, ada=ADA_PLOKK)["ada"]["handle"] == "10062/7822"


def test_fetch_kordus_annab_409(client, login, monkeypatch):
    uid = _loo(client, login, ada=ADA_PLOKK)["id"]

    monkeypatch.setattr(upload_router.ada_fetch, "alusta_fetchi", lambda u: True)
    assert client.post("/admin/upload/{}/ada-fetch".format(uid),
                       headers=_peis(login)).status_code == 200

    monkeypatch.setattr(upload_router.ada_fetch, "alusta_fetchi", lambda u: False)
    assert client.post("/admin/upload/{}/ada-fetch".format(uid),
                       headers=_peis(login)).status_code == 409


def test_ilma_ada_plokita_upload_ei_saa_fetchida(client, login):
    uid = _loo(client, login, title="Tavaline", slug="tavaline")["id"]
    r = client.post("/admin/upload/{}/ada-fetch".format(uid), headers=_peis(login))
    assert r.status_code == 400
```

- [ ] **Step 2: Jooksuta test, veendu et kukub**

Run: `.venv/bin/pytest tests/test_ada_fetch_endpoint.py -v`
Expected: FAIL — 404 fetch-marsruudile, `KeyError: 'ada'` create-testis.

- [ ] **Step 3: Lase `ada` plokk läbi `create_upload`-ist**

`server/upload_ops.py`, funktsioonis `create_upload`, `state` dikti (read ~204–231) lõppu:

```python
        # ADA lähtekaart. `sources` lehepiirid (`first_src_page`, `page_count`)
        # täidab fetch alles pärast liitmist — siin on ainult nimed ja uuid-d.
        "ada": meta.get('ada') or None,
```

- [ ] **Step 4: Lisa fetch-endpoint**

`server/routers/upload.py`:

```python
from ..ada import fetch as ada_fetch


@router.post("/admin/upload/{upload_id}/ada-fetch")
def admin_upload_ada_fetch(upload_id: str, user=Depends(require_role("admin"))):
    """Käivitab ADA failide allalaadimise taustalõimes.

    SÜNKROONNE def: `alusta_fetchi` loeb ja kirjutab state.json-i (blokeeriv I/O).
    """
    if not _valid_upload_id(upload_id):
        raise HTTPException(status_code=400, detail="Vigane upload_id")
    state = upload_state.read_state(upload_id)
    if not state:
        raise HTTPException(status_code=404, detail="Uploadi ei leitud")
    if not (state.get("ada") or {}).get("sources"):
        raise HTTPException(status_code=400, detail="Sellel uploadil ei ole ADA lähtekaarti")
    if not ada_fetch.alusta_fetchi(upload_id):
        raise HTTPException(status_code=409, detail="Allalaadimine juba käib")
    return {"status": "ada_fetching"}
```

- [ ] **Step 5: Lisa ADA-staatused polli varajase väljumise loendisse**

**See puudus spekist ja annaks elava vea.** `admin_upload_status` kutsub
`poll_and_sync_thumbs`-i tingimusteta, ja `upload/thumbs.py:163` väljub varakult ainult
loetletud staatuste korral. `ada_fetching` ajal ei ole OCR-serveris veel MIDAGI —
poll üritaks SFTP-ga kaugkausta lugeda ja saaks vea (halvemal juhul aegumise).

`server/upload/thumbs.py`, funktsioonis `poll_and_sync_thumbs`, laienda loendit:

```python
    if current_status in (
        "pending", "uploading", "error", "imported", "collecting_images",
        # ADA allalaadimine käib VUTT-i poolel; OCR-serveris ei ole veel midagi.
        "ada_fetching", "ada_error",
    ) + upload_state.PREPRESS_IDLE_STATUSES:
```

Lisa test `tests/test_ada_fetch_endpoint.py`-sse:

```python
def test_poll_ei_puuduta_sftp_d_ada_fetchingu_ajal(client, login, monkeypatch):
    """OCR-serveris ei ole veel midagi — SFTP kutse oleks viga, mitte ootamine."""
    from server.upload import thumbs
    uid = _loo(client, login, ada=ADA_PLOKK)["id"]
    from server.upload import state as upload_state
    upload_state.set_upload_state(uid, status="ada_fetching")
    monkeypatch.setattr(thumbs, "sftp_open",
                        lambda *a, **k: pytest.fail("SFTP-d ei tohi avada"))
    r = client.get("/admin/upload/{}/status".format(uid), headers=_peis(login))
    assert r.status_code == 200
    assert r.json()["status"] == "ada_fetching"
```

- [ ] **Step 6: Ühenda käivitustaaste lifespan'i**

`server/main.py`, teiste taustalõimede kõrvale (read 55–62):

```python
    # Rippuv ada_fetching → ada_error. Ilma selleta blokeeriks CAS „Laen uuesti"
    # nupu igaveseks, sest upload_progress kadus restardiga.
    from .ada.fetch import taasta_rippuvad_fetchid
    threading.Thread(target=taasta_rippuvad_fetchid, daemon=True,
                     name="ada-fetch-recovery").start()
```

- [ ] **Step 7: Jooksuta testid, veendu et lähevad läbi**

Run: `.venv/bin/pytest tests/test_ada_fetch_endpoint.py tests/test_backend_smoke.py tests/test_upload_meta_fields.py tests/test_upload_apply_poll.py -v`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/routers/upload.py server/upload_ops.py server/main.py \
        server/upload/thumbs.py tests/test_ada_fetch_endpoint.py
git commit -m "feat(ada): ada-fetch endpoint ja käivitustaaste

Kordus annab 409, mitte teist töölõime. Käivitusel märgitakse rippuv
ada_fetching veaks, muidu jääks 'Laen uuesti' CAS-i taha kinni."
```

---

## Task 8: Provenance imporditud lehtedele

**Files:**
- Create: `server/ada/provenance.py`
- Modify: `server/upload/import_work.py` (read ~185–215)
- Test: `tests/test_ada_provenance.py`

**Interfaces:**
- Consumes: `state.json` → `ada.sources`, `prepress.page_map`
- Produces:
  - `leia_ankrud(sources: List[dict], page_map: Dict[str, List[int]], sailinud_out: List[int]) -> Dict[int, dict]` — lõplik leheküljenumber (1-põhine, ümbernummerdatud) → allika kirje.
  - `ehita_source_vali(handle, allikas) -> dict`
  - `ehita_kommentaar(handle, allikas) -> dict`

- [ ] **Step 1: Kirjuta kukkuv test**

Loo `tests/test_ada_provenance.py`:

```python
"""Ankru resolutsioon: ADA tükk → lõplik leheküljenumber pärast excluded + deleted."""
from server.ada import provenance

SOURCES = [
    {"name": "a.pdf", "bitstream_uuid": "ua", "first_src_page": 1, "page_count": 2},
    {"name": "b.pdf", "bitstream_uuid": "ub", "first_src_page": 3, "page_count": 2},
]


def test_lihtne_juht_ankur_on_tuki_esimene_leht():
    page_map = {"1": [1], "2": [2], "3": [3], "4": [4]}
    ankrud = provenance.leia_ankrud(SOURCES, page_map, sailinud_out=[1, 2, 3, 4])
    assert ankrud[1]["name"] == "a.pdf"
    assert ankrud[3]["name"] == "b.pdf"


def test_excluded_esimene_leht_ankur_libiseb_jargmisele():
    """src 1 jäeti sammus 3 välja → kaardis puudub; ankur on tüki teine leht."""
    page_map = {"2": [1], "3": [2], "4": [3]}
    ankrud = provenance.leia_ankrud(SOURCES, page_map, sailinud_out=[1, 2, 3])
    assert ankrud[1]["name"] == "a.pdf"


def test_poolitatud_leht_esimene_pool_kustutatud():
    """src 1 → out 1,2. Admin kustutab sammus 4 out 1. Ankur PEAB olema out 2.

    See on täpselt see juht, mille `page_map: int` vaikselt valesti lahendaks.
    """
    page_map = {"1": [1, 2], "2": [3], "3": [4], "4": [5]}
    ankrud = provenance.leia_ankrud(SOURCES, page_map, sailinud_out=[2, 3, 4, 5])
    # out 2 on säilinute seas esimene → lõplik nr 1
    assert ankrud[1]["name"] == "a.pdf"


def test_poolitatud_lehe_molemad_pooled_kustutatud():
    """Ankur libiseb tüki JÄRGMISELE lähtelehele."""
    page_map = {"1": [1, 2], "2": [3], "3": [4], "4": [5]}
    ankrud = provenance.leia_ankrud(SOURCES, page_map, sailinud_out=[3, 4, 5])
    # out 3 (src 2) on säilinute seas esimene → lõplik nr 1
    assert ankrud[1]["name"] == "a.pdf"


def test_terve_tukk_valja_jaetud_ankrut_ei_teki():
    """Vale kohta EI panda — pigem mitte midagi."""
    page_map = {"3": [1], "4": [2]}
    ankrud = provenance.leia_ankrud(SOURCES, page_map, sailinud_out=[1, 2])
    assert all(a["name"] != "a.pdf" for a in ankrud.values())
    assert ankrud[1]["name"] == "b.pdf"


def test_lopliku_numbri_umbernummerdus():
    """sailinud_out on juba sorditud; lõplik number on POSITSIOON, mitte out_index."""
    page_map = {"1": [5], "3": [9]}
    ankrud = provenance.leia_ankrud(SOURCES, page_map, sailinud_out=[5, 7, 9])
    assert ankrud[1]["name"] == "a.pdf"
    assert ankrud[3]["name"] == "b.pdf"


def test_source_vali_kuju():
    v = provenance.ehita_source_vali("10062/7822", SOURCES[0])
    assert v == {"provider": "ada", "handle": "10062/7822",
                 "bitstream_uuid": "ua", "name": "a.pdf"}


def test_kommentaar_sisaldab_nime_ja_urli():
    k = provenance.ehita_kommentaar("10062/7822", SOURCES[0])
    assert "a.pdf" in k["text"]
    assert "ua" in k["text"]
    assert k["author"] == "ada-import"
```

- [ ] **Step 2: Jooksuta test, veendu et kukub**

Run: `.venv/bin/pytest tests/test_ada_provenance.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'server.ada.provenance'`.

- [ ] **Step 3: Kirjuta `server/ada/provenance.py`**

```python
"""ADA lähtefaili → lõplik leheküljenumber. PUHAS: null I/O.

Kaks nihet on vahel: sammu 3 `excluded` (leht ei jõua OCR-i) ja sammu 4
`deleted` (leht ei jõua VUTT-i). `page_map` katab esimese, `sailinud_out`
teise.
"""
from datetime import datetime
from typing import Dict, List

KOMMENTAARI_AUTOR = "ada-import"
BITSTREAM_URL = "https://dspace.ut.ee/server/api/core/bitstreams/{}/content"


def leia_ankrud(sources: List[dict], page_map: Dict[str, List[int]],
                sailinud_out: List[int]) -> Dict[int, dict]:
    """ADA tükk → lõplik leheküljenumber, kuhu provenance kirjutatakse.

    Iga tüki kohta otsitakse esimene väljundleht, mis elas üle MÕLEMAD nihked.
    Tükk, millest ei jäänud ühtki lehte, ankrut ei saa — vale kohta ei panda.
    """
    sailinud = sorted(sailinud_out)
    positsioon = {out: i + 1 for i, out in enumerate(sailinud)}
    ankrud = {}
    for allikas in sources:
        algus = int(allikas.get("first_src_page") or 0)
        lopp = algus + int(allikas.get("page_count") or 0) - 1
        leitud = None
        for src in range(algus, lopp + 1):
            for out in page_map.get(str(src)) or []:
                if out in positsioon:
                    leitud = positsioon[out]
                    break
            if leitud is not None:
                break
        # Kaks tükki ei tohi sama lehte hõivata: esimene võidab.
        if leitud is not None and leitud not in ankrud:
            ankrud[leitud] = allikas
    return ankrud


def ehita_source_vali(handle: str, allikas: dict) -> dict:
    """Masinloetav provenance lehe JSON-i juurtasandil."""
    return {
        "provider": "ada",
        "handle": handle,
        "bitstream_uuid": allikas.get("bitstream_uuid"),
        "name": allikas.get("name"),
    }


def ehita_kommentaar(handle: str, allikas: dict) -> dict:
    """Inimloetav sama info. Kommentaari kuju järgib olemasolevat `comments` massiivi."""
    return {
        "author": KOMMENTAARI_AUTOR,
        "text": "ADA: {}\n{}".format(
            allikas.get("name"), BITSTREAM_URL.format(allikas.get("bitstream_uuid"))
        ),
        "created_at": datetime.now().isoformat(),
    }
```

- [ ] **Step 4: Ühenda import'i**

`server/upload/import_work.py`. Enne lehtede silmust (rida ~185), arvuta ankrud:

```python
    # ADA provenance: milline lõplik lehekülg kannab millise lähtefaili viidet.
    ada_plokk = state.get('ada') or {}
    ada_ankrud = {}
    if ada_plokk.get('sources'):
        from ..ada import provenance as ada_provenance
        page_map = ((state.get('prepress') or {}).get('page_map')) or {}
        ada_ankrud = ada_provenance.leia_ankrud(
            ada_plokk['sources'], page_map, [f['page'] for f in importable]
        )
```

ja asenda `page_json` konstruktsioon (rida ~213):

```python
            page_json = {"sequence": pn * 100, "status": "Toores", "page_tags": [],
                         "comments": [], "history": []}
            allikas = ada_ankrud.get(jrk)
            if allikas:
                page_json["source"] = ada_provenance.ehita_source_vali(
                    ada_plokk.get('handle', ''), allikas
                )
                page_json["comments"].append(
                    ada_provenance.ehita_kommentaar(ada_plokk.get('handle', ''), allikas)
                )
```

**NB:** silmuse päis muutub `for entry in importable:` → `for jrk, entry in
enumerate(importable, start=1):`. `importable` on juba `page` järgi sorditud (rida ~153),
seega `jrk` ONGI lõplik ümbernummerdatud leheküljenumber — sama arv, mille
`leia_ankrud` `sailinud_out`-i positsioonist arvutas.

- [ ] **Step 5: Jooksuta testid, veendu et lähevad läbi**

Run: `.venv/bin/pytest tests/test_ada_provenance.py tests/test_err_page_import.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/ada/provenance.py server/upload/import_work.py tests/test_ada_provenance.py
git commit -m "feat(ada): provenance imporditud lehtedele

Ankur läbib kaks nihet: sammu 3 excluded (page_map) ja sammu 4 deleted
(sailinud_out). Poolitatud lehe ühe poole kustutamine libistab ankru teisele
poolele; tükist, millest midagi alles ei jäänud, viidet EI teki."
```

---

## Task 9: Gemini pealkirja tõlge

**Files:**
- Modify: `server/ocr_providers/gemini.py`
- Modify: `server/routers/upload.py` (lookup lisab `title_suggestion`)
- Test: `tests/test_gemini_title.py`

**Interfaces:**
- Produces: `gemini.translate_title(eestikeelne: str) -> Optional[str]` — ingliskeelne pealkiri või `None`, kui Gemini on välja lülitatud või kukkus. **Ei viska erandit** — tõlge ei tohi importi blokeerida.

- [ ] **Step 1: Kirjuta kukkuv test**

Loo `tests/test_gemini_title.py`:

```python
"""Pealkirja tõlge: tekstipoolne Gemini-kutse, mis EI blokeeri importi."""
import pytest

from server.ocr_providers import gemini


def test_valja_lulitatud_gemini_annab_none(monkeypatch):
    monkeypatch.setattr(gemini, "GEMINI_API_KEY", "")
    assert gemini.translate_title("65 kirja Karl Morgensternile") is None


def test_vorgu_viga_annab_none_mitte_erandit(monkeypatch):
    monkeypatch.setattr(gemini, "GEMINI_API_KEY", "võti")

    def kukub(*a, **k):
        raise IOError("võrk maas")

    monkeypatch.setattr(gemini.requests, "post", kukub)
    assert gemini.translate_title("Pealkiri") is None


def test_juhis_keelab_parisnimede_tolkimise(monkeypatch):
    """Karl Morgenstern ja St. Petersburg EI OLE tõlgitavad."""
    monkeypatch.setattr(gemini, "GEMINI_API_KEY", "võti")
    saadetud = {}

    class Vastus:
        status_code = 200

        def json(self):
            return {"steps": [{"type": "model_output", "content": "65 letters"}]}

    def spioon(url, json=None, headers=None, timeout=None):
        saadetud["payload"] = json
        return Vastus()

    monkeypatch.setattr(gemini.requests, "post", spioon)
    gemini.translate_title("65 kirja")
    juhis = str(saadetud["payload"])
    assert "pärisnime" in juhis.lower() or "proper name" in juhis.lower()


def test_tyhi_sisend_ei_kutsu_apit(monkeypatch):
    monkeypatch.setattr(gemini, "GEMINI_API_KEY", "võti")
    monkeypatch.setattr(gemini.requests, "post",
                        lambda *a, **k: pytest.fail("ei tohi kutsuda"))
    assert gemini.translate_title("   ") is None
```

- [ ] **Step 2: Jooksuta test, veendu et kukub**

Run: `.venv/bin/pytest tests/test_gemini_title.py -v`
Expected: FAIL — `AttributeError: module has no attribute 'translate_title'`.

- [ ] **Step 3: Lisa `translate_title` `gemini.py` lõppu**

```python
TOLKE_JUHIS = (
    "Tõlgi järgnev raamatukogukirje pealkiri eesti keelest inglise keelde. "
    "Pärisnimesid (isikunimed, kohanimed) EI tõlgita — need jäävad muutmata. "
    "Tagasta AINULT tõlge, ilma selgituste ja jutumärkideta."
)


def translate_title(eestikeelne: str) -> Optional[str]:
    """Eestikeelne pealkiri → ingliskeelne. None = ei õnnestunud.

    EI VISKA erandit: tõlge on mugavus, mitte impordi eeltingimus. Ebaõnnestunud
    tõlke korral jääb pealkiri eestikeelseks ja admin kirjutab ise.

    Taaskasutab sama API_URL-i, võtit ja `_extract_text`-i mis `transcribe()` —
    erinevus on ainult selles, et sisendiks on tekst, mitte pilt.
    """
    tekst = (eestikeelne or "").strip()
    if not tekst or not GEMINI_API_KEY:
        return None  # `GEMINI_API_KEY` on moodulitasandi konstant — test patchib selle
    # `input` on LAME plokkide list, mitte role/content-struktuur — sama kuju
    # nagu `build_payload` (gemini.py:69). `store: False` väldib skannide ja
    # pealkirjade Google'isse seisma jäämist; `thinking_level` PEAB olema
    # `generation_config` sees, ülemisel tasemel annab API 400.
    payload = {
        "model": GEMINI_OCR_MODEL,
        "store": False,
        "generation_config": {"thinking_level": GEMINI_THINKING_LEVEL},
        "input": [
            {"type": "text", "text": TOLKE_JUHIS},
            {"type": "text", "text": tekst},
        ],
    }
    try:
        vastus = requests.post(
            API_URL, json=payload,
            headers={"x-goog-api-key": _api_key(), "Content-Type": "application/json"},
            timeout=GEMINI_REQUEST_TIMEOUT,
        )
        if vastus.status_code != 200:
            logger.warning("Pealkirja tõlge: %s", _error_summary(vastus))
            return None
        tolge = (_extract_text(vastus.json()) or "").strip()
        return tolge or None
    except Exception as e:
        logger.warning("Pealkirja tõlge kukkus: %s", e)
        return None
```

**Kontrollitud** `gemini.py:69–86` vastu: `input` on lame plokkide list kujul
`{"type": "text", "text": ...}`, `store: False` on ülemisel tasemel ja
`thinking_level` `generation_config` sees. Päised on
`{"x-goog-api-key": _api_key(), "Content-Type": "application/json"}` (rida 211).
API kuju on teostusdetail ja Google on seda muutnud — kui test kukub 400-ga,
võrdle `build_payload`-iga, mitte selle plaaniga.

- [ ] **Step 4: Ühenda lookup'i**

`server/routers/upload.py`, `admin_ada_lookup`-is enne tagastust:

```python
    # Kakskeelne pealkiri ühes lahtris. Pakkumine, mitte otsus — UI märgistab
    # selle masintõlkena kuni admin lahtrit puudutab.
    ingliskeelne = await run_in_threadpool(
        gemini.translate_title, tulemus["meta"].get("title", "")
    )
    if ingliskeelne:
        tulemus["title_suggestion"] = "{} / {}".format(
            tulemus["meta"]["title"], ingliskeelne
        )
```

koos impordiga `from ..ocr_providers import gemini`.

- [ ] **Step 5: Jooksuta testid**

Run: `.venv/bin/pytest tests/test_gemini_title.py tests/test_gemini_client.py tests/test_ada_lookup_endpoint.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/ocr_providers/gemini.py server/routers/upload.py tests/test_gemini_title.py
git commit -m "feat(ada): Gemini pakub ingliskeelse pealkirja poole

Tekstipoolne kutse taaskasutab sama võtit ja _extract_text'i mis OCR.
Ebaõnnestumine annab None, mitte erandi — tõlge ei ole impordi eeltingimus."
```

---

## Task 10: Frontend — ADA riba viisardi 1. sammus

**Files:**
- Create: `src/pages/upload/adaApi.ts`
- Create: `src/pages/upload/components/AdaImportBar.tsx`
- Modify: `src/pages/upload/types.ts`
- Modify: `src/pages/upload/components/UploadStepMeta.tsx`
- Modify: `src/locales/et/upload.json`, `src/locales/en/upload.json`
- Test: `src/pages/upload/__tests__/adaMerge.test.ts`

**Interfaces:**
- Consumes: `apiPost` (`src/services/apiClient.ts`)
- Produces:
  - `adaLookup(handle: string): Promise<AdaLookupResult>`
  - `interface AdaLookupResult { handle; item_uuid; meta; failid: AdaFile[]; kogu_baite; vahele_jaetud: string[]; title_suggestion?: string }`
  - `mergeAdaIntoForm(praegune, ada) -> { vaartused, ulekirjutatavad }` — puhas funktsioon, testitav ilma DOM-ita.

- [ ] **Step 1: Kirjuta kukkuv test**

Loo `src/pages/upload/__tests__/adaMerge.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mergeAdaIntoForm } from '../adaApi';

const ADA = {
  title: '65 kirja Karl Morgensternile',
  year: '1812',
  year_display: '1812-1823',
  languages: ['deu'],
};

describe('mergeAdaIntoForm', () => {
  it('täidab tühjad väljad', () => {
    const { vaartused } = mergeAdaIntoForm({ title: '', year: '' }, ADA);
    expect(vaartused.title).toBe('65 kirja Karl Morgensternile');
    expect(vaartused.year).toBe('1812');
  });

  it('EI kirjuta üle admini käsitsi sisestatut', () => {
    const { vaartused } = mergeAdaIntoForm({ title: 'Minu pealkiri', year: '' }, ADA);
    expect(vaartused.title).toBe('Minu pealkiri');
    expect(vaartused.year).toBe('1812');
  });

  it('loetleb väljad, mille ADA väärtus erineb', () => {
    const { ulekirjutatavad } = mergeAdaIntoForm({ title: 'Minu pealkiri', year: '' }, ADA);
    expect(ulekirjutatavad.map((u) => u.vali)).toEqual(['title']);
    expect(ulekirjutatavad[0].adaVaartus).toBe('65 kirja Karl Morgensternile');
  });

  it('identne väärtus ei ole ülekirjutatav', () => {
    const { ulekirjutatavad } = mergeAdaIntoForm({ title: ADA.title, year: '1812' }, ADA);
    expect(ulekirjutatavad).toEqual([]);
  });

  it('tühi ADA väli ei kustuta admini oma', () => {
    const { vaartused } = mergeAdaIntoForm({ title: 'Minu' }, { ...ADA, title: '' });
    expect(vaartused.title).toBe('Minu');
  });
});
```

- [ ] **Step 2: Jooksuta test, veendu et kukub**

Run: `npx vitest run src/pages/upload/__tests__/adaMerge.test.ts`
Expected: FAIL — `Cannot find module '../adaApi'`.

- [ ] **Step 3: Kirjuta `src/pages/upload/adaApi.ts`**

```ts
import { apiPost } from '../../services/apiClient';
import type { AdaLookupResult, AdaMergeTulemus, AdaVormiVali } from './types';

/** Handle → ADA metaandmed + failiplaan. Ei loo uploadi. */
export async function adaLookup(handle: string): Promise<AdaLookupResult> {
  const vastus = await apiPost<{ status: string; ada: AdaLookupResult }>(
    '/admin/ada/lookup',
    { handle },
  );
  return vastus.ada;
}

/** Käivitab ADA failide allalaadimise. 409 = juba käib. */
export async function adaFetch(uploadId: string): Promise<void> {
  await apiPost(`/admin/upload/${uploadId}/ada-fetch`, {});
}

/** Väljad, mida ADA täidab. Puhas nimekiri — UI ja test kasutavad sama. */
const ADA_VALJAD: AdaVormiVali[] = ['title', 'year', 'year_display'];

/**
 * Liidab ADA väärtused vormi nii, et admini käsitsi sisestatu EI kao.
 *
 * Tühjad väljad täidetakse; mittetühjad jäävad puutumata ja loetletakse
 * `ulekirjutatavad`-is, et UI saaks pakkuda ühekordset „võta ADA oma" nuppu.
 */
export function mergeAdaIntoForm(
  praegune: Partial<Record<AdaVormiVali, string>>,
  ada: Partial<Record<AdaVormiVali, string>>,
): AdaMergeTulemus {
  const vaartused: Record<string, string> = { ...praegune };
  const ulekirjutatavad: Array<{ vali: AdaVormiVali; adaVaartus: string }> = [];

  for (const vali of ADA_VALJAD) {
    const adaVaartus = (ada[vali] ?? '').trim();
    if (!adaVaartus) continue;
    const olemasolev = (praegune[vali] ?? '').trim();
    if (!olemasolev) {
      vaartused[vali] = adaVaartus;
    } else if (olemasolev !== adaVaartus) {
      ulekirjutatavad.push({ vali, adaVaartus });
    }
  }
  return { vaartused, ulekirjutatavad };
}
```

- [ ] **Step 4: Lisa tüübid `src/pages/upload/types.ts`-i**

```ts
export type AdaVormiVali = 'title' | 'year' | 'year_display';

export interface AdaFile {
  name: string;
  bitstream_uuid: string;
  size_bytes: number;
  /** 0 = täiskuupäev, 1 = kuu+aasta, 2 = aasta, 3 = parsimatu. >0 → UI hoiatusmärk. */
  tapsus: number;
}

export interface AdaLookupResult {
  handle: string;
  item_uuid: string;
  meta: {
    title: string;
    year: string;
    year_display: string;
    creators: Array<{ label: string }>;
    languages: string[];
    ester_id: string | null;
    archive_refs: Array<{ archive_id: string; reference: string }>;
    external_url: string | null;
  };
  failid: AdaFile[];
  kogu_baite: number;
  vahele_jaetud: string[];
  /** Gemini pakutud „eesti / english" kuju. Puudub, kui tõlge ei õnnestunud. */
  title_suggestion?: string;
  /** Sama handle on juba imporditud (Task 12). HOIATUS, mitte blokeering. */
  olemasolev?: { work_id: string; title: string };
}

export interface AdaMergeTulemus {
  vaartused: Record<string, string>;
  ulekirjutatavad: Array<{ vali: AdaVormiVali; adaVaartus: string }>;
}
```

- [ ] **Step 5: Jooksuta test, veendu et läheb läbi**

Run: `npx vitest run src/pages/upload/__tests__/adaMerge.test.ts`
Expected: PASS, 5 testi.

- [ ] **Step 6: Kirjuta `AdaImportBar.tsx`**

Loo `src/pages/upload/components/AdaImportBar.tsx`. Komponent on **esitusloogika**:
sisend + nupp + kokkuvõte + kokkuklapitav faililoend. Kogu olek tuleb propsidena.

```tsx
import React, { useState } from 'react';
import { ChevronDown, Loader2, AlertTriangle, Check } from 'lucide-react';
import type { AdaLookupResult } from '../types';

interface Props {
  handle: string;
  setHandle: (v: string) => void;
  laeb: boolean;
  viga: string;
  tulemus: AdaLookupResult | null;
  onTomba: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function mb(baite: number): string {
  return `${Math.round(baite / 1024 / 1024)} MB`;
}

const AdaImportBar: React.FC<Props> = ({
  handle, setHandle, laeb, viga, tulemus, onTomba, t,
}) => {
  const [avatud, setAvatud] = useState(false);
  return (
    <div className="mb-6 border border-gray-200 rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200">
        <span className="text-xs font-semibold text-gray-700">{t('ada.title')}</span>
      </div>
      <div className="p-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder={t('ada.placeholder')}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm
                       focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <button
            type="button"
            onClick={onTomba}
            disabled={laeb || !handle.trim()}
            className="px-4 py-2 text-sm rounded-lg bg-primary-600 text-white
                       disabled:opacity-50 flex items-center gap-2"
          >
            {laeb && <Loader2 size={14} className="animate-spin" />}
            {t('ada.fetch')}
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-1">{t('ada.hint')}</p>

        {viga && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg
                          text-sm text-red-700">{viga}</div>
        )}

        {tulemus && (
          <div className="mt-3 text-sm">
            <div className="flex items-start gap-2">
              <Check size={14} className="text-green-600 mt-0.5 shrink-0" />
              <span className="font-medium text-gray-900">{tulemus.meta.title}</span>
            </div>
            <div className="text-xs text-gray-600 mt-1">
              {[
                tulemus.meta.creators.map((c) => c.label).join('; '),
                tulemus.meta.year,
                tulemus.meta.archive_refs.map((a) => `${a.archive_id} ${a.reference}`).join('; '),
              ].filter(Boolean).join(' · ')}
            </div>
            <button
              type="button"
              onClick={() => setAvatud(!avatud)}
              className="mt-2 text-xs text-primary-600 flex items-center gap-1"
            >
              {t('ada.fileCount', { count: tulemus.failid.length, size: mb(tulemus.kogu_baite) })}
              <ChevronDown size={12} className={avatud ? 'rotate-180' : ''} />
            </button>
            {avatud && (
              <ol className="mt-2 max-h-52 overflow-y-auto text-xs text-gray-700
                             border border-gray-200 rounded-lg divide-y">
                {tulemus.failid.map((f, i) => (
                  <li key={f.bitstream_uuid} className="px-2 py-1 flex items-center gap-2">
                    <span className="text-gray-400 w-8 text-right">{i + 1}.</span>
                    <span className="flex-1">{f.name}</span>
                    {f.tapsus > 0 && (
                      <span className="text-amber-600 flex items-center gap-1">
                        <AlertTriangle size={11} />
                        {t(`ada.precision.${f.tapsus}`)}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            )}
            {tulemus.vahele_jaetud.length > 0 && (
              <p className="mt-2 text-xs text-amber-700">
                {t('ada.skipped', { files: tulemus.vahele_jaetud.join(', ') })}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default AdaImportBar;
```

Renderda see `UploadStepMeta.tsx`-is kohe `<h2>` järel, enne `replaceWorkId` plokki.

- [ ] **Step 7: Lisa i18n võtmed MÕLEMASSE keelde**

`src/locales/et/upload.json`:

```json
"ada": {
  "title": "Impordi ADA-st",
  "placeholder": "10062/7822",
  "hint": "Handle, hdl:-viide või dspace.ut.ee URL",
  "fetch": "Tõmba",
  "fileCount": "{{count}} faili, {{size}}",
  "skipped": "Vahele jäetud (ei ole PDF): {{files}}",
  "precision": { "1": "ainult kuu", "2": "ainult aasta", "3": "dateerimata" },
  "machineTranslation": "masintõlge, kontrolli",
  "takeAda": "võta ADA oma",
  "downloading": "Laen ADA-st",
  "downloadProgress": "{{done}}/{{total}} faili · {{mbDone}}/{{mbTotal}} MB",
  "retry": "Laen uuesti"
}
```

`src/locales/en/upload.json` — **sama struktuur, ingliskeelsed väärtused**. `fallbackLng`
on väljas: puuduv võti murrab buildi (`localeParity.test.ts`).

- [ ] **Step 8: Jooksuta väravad**

Run: `npm run typecheck && npx vitest run src/pages/upload src/locales && npm run lint:ci`
Expected: PASS, sh `localeParity.test.ts` roheline.

- [ ] **Step 9: Commit**

```bash
git add src/pages/upload/adaApi.ts src/pages/upload/components/AdaImportBar.tsx \
        src/pages/upload/types.ts src/pages/upload/components/UploadStepMeta.tsx \
        src/pages/upload/__tests__/adaMerge.test.ts src/locales/et/upload.json src/locales/en/upload.json
git commit -m "feat(ada): ADA riba viisardi 1. sammus

mergeAdaIntoForm on puhas: tühjad väljad täidetakse, admini käsitsi sisestatu
jääb puutumata ja erinevus pakutakse ühekordse nupuga."
```

---

## Task 11: Frontend — ADA haru viisardi 2. sammus

**Files:**
- Modify: `src/pages/upload/useUploadWizard.ts`
- Modify: `src/pages/upload/components/UploadStepTransfer.tsx`
- Modify: `src/pages/upload/constants.ts`
- Test: `src/pages/upload/__tests__/adaWizard.test.ts`

**Interfaces:**
- Consumes: `adaLookup`, `adaFetch`, `mergeAdaIntoForm` (Task 10); `getUploadStatus` (olemasolev)
- Produces: viisardi olekumasina ADA-haru — `ada_fetching` ja `ada_error` staatuste käsitlus.

- [ ] **Step 1: Kirjuta kukkuv test**

Loo `src/pages/upload/__tests__/adaWizard.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { adaSammuOlek, ADA_TRANSFER_STATUSES } from '../constants';

describe('ADA staatuste marsruutimine', () => {
  it('ada_fetching kuulub 2. sammu, mitte 3. sammu', () => {
    expect(adaSammuOlek('ada_fetching')).toBe(2);
  });

  it('ada_error kuulub samuti 2. sammu (seal on "Laen uuesti")', () => {
    expect(adaSammuOlek('ada_error')).toBe(2);
  });

  it('awaiting_split viib 3. sammu', () => {
    expect(adaSammuOlek('awaiting_split')).toBe(3);
  });

  it('ada_fetching EI OLE prepress-staatus', () => {
    // Muidu viskaks polling admini poolitamise vaatesse keset allalaadimist.
    expect(ADA_TRANSFER_STATUSES).toContain('ada_fetching');
  });
});
```

- [ ] **Step 2: Jooksuta test, veendu et kukub**

Run: `npx vitest run src/pages/upload/__tests__/adaWizard.test.ts`
Expected: FAIL — `adaSammuOlek` ei ole eksporditud.

- [ ] **Step 3: Lisa konstandid ja marsruutimine**

`src/pages/upload/constants.ts`:

```ts
/** ADA allalaadimine käib → viisardi 2. samm (progressiriba failivalija asemel). */
export const ADA_TRANSFER_STATUSES = ['ada_fetching', 'ada_error'];

/** Staatus → viisardi samm ADA-voos. */
export function adaSammuOlek(status: string): number {
  if (ADA_TRANSFER_STATUSES.includes(status)) return 2;
  if (['awaiting_split', 'prepping'].includes(status)) return 3;
  return 4;
}
```

- [ ] **Step 4: Ühenda `useUploadWizard.ts`-i**

Kolm muudatust:

1. **ADA lookup 1. sammus** — uus olek ja käsitleja:

```ts
  const [adaHandle, setAdaHandle] = useState('');
  const [adaLaeb, setAdaLaeb] = useState(false);
  const [adaViga, setAdaViga] = useState('');
  const [adaTulemus, setAdaTulemus] = useState<AdaLookupResult | null>(null);

  const handleAdaTomba = useCallback(async () => {
    setAdaLaeb(true);
    setAdaViga('');
    try {
      const tulemus = await adaLookup(adaHandle);
      setAdaTulemus(tulemus);
      const { vaartused } = mergeAdaIntoForm(
        { title, year },
        { ...tulemus.meta, title: tulemus.title_suggestion || tulemus.meta.title },
      );
      setTitle(vaartused.title ?? title);
      setYear(vaartused.year ?? year);
      // Käsikiri on ADA-materjali peamine kuju, aga lüliti jääb nähtavaks ja
      // admini muuta — meta.type on bibliograafiline väide (ADR 0028 §3).
      setWorkType(TYPE_HAND);
    } catch (e) {
      setAdaViga(e instanceof ApiError ? e.message : String(e));
    } finally {
      setAdaLaeb(false);
    }
  }, [adaHandle, title, year]);
```

2. **`create` kannab ADA-ploki kaasa** ja käivitab kohe fetchi:

```ts
      const upload = await createUpload({
        title, year, slug, type: workType,
        collections: selectedCollection ? [selectedCollection] : [],
        ...(adaTulemus ? {
          ada: {
            handle: adaTulemus.handle,
            item_uuid: adaTulemus.item_uuid,
            sources: adaTulemus.failid.map((f) => ({
              name: f.name,
              bitstream_uuid: f.bitstream_uuid,
              size_bytes: f.size_bytes,
            })),
          },
          languages: adaTulemus.meta.languages,
          creators: adaTulemus.meta.creators,
          year_display: adaTulemus.meta.year_display,
          ester_id: adaTulemus.meta.ester_id,
          archive_refs: adaTulemus.meta.archive_refs,
          external_url: adaTulemus.meta.external_url,
        } : {}),
      });
      if (adaTulemus) {
        await adaFetch(upload.id);
      }
```

3. **`PREPRESS_STATUSES` ja polling** — `ada_fetching` EI TOHI kuuluda
`PREPRESS_STATUSES`-esse (muidu viskaks polling admini poolitamise vaatesse keset
allalaadimist, sama viga nagu `applying` ADR 0028-s). Lisa pollimise haru:

```ts
    if (ADA_TRANSFER_STATUSES.includes(poll.status)) {
      setStep(2);
      setAdaProgress(poll.progress ?? null);
      return;
    }
```

- [ ] **Step 5: Lisa progressiriba `UploadStepTransfer.tsx`-i**

ADA-voos asendub failivalija progressiribaga. Vea korral (`ada_error`) näidatakse
serveri sõnum + „Laen uuesti" nupp, mis kutsub sama `adaFetch(uploadId)`-i — CAS
lubab `ada_error → ada_fetching` ja juba allalaaditud tükke ei tõmmata uuesti.

- [ ] **Step 6: Jooksuta väravad**

Run: `npm run typecheck && npm test && npm run lint:ci`
Expected: PASS. Kui `lint:ci` hoiatuste arv langes, **LANGETA `--max-warnings` arvu**
`package.json`-is.

- [ ] **Step 7: Commit**

```bash
git add src/pages/upload/useUploadWizard.ts src/pages/upload/constants.ts \
        src/pages/upload/components/UploadStepTransfer.tsx \
        src/pages/upload/__tests__/adaWizard.test.ts
git commit -m "feat(ada): viisardi 2. samm on ADA-voos progressiriba

ada_fetching EI kuulu PREPRESS_STATUSES-esse — muidu viskaks polling admini
poolitamise vaatesse keset allalaadimist (sama viga nagu applying, ADR 0028)."
```

---

## Task 12: Duplikaadi hoiatus (ainus, mis tohib skoobist välja langeda)

Kui see osutub kalliks, jäta tegemata ja märgi spekki. Kõik muu on kohustuslik.

**Files:**
- Modify: `server/meili_settings.py` (`FILTERABLE_ATTRIBUTES`)
- Modify: `mcp/tests/test_meili_contract.py`
- Modify: `server/routers/upload.py` (`admin_ada_lookup`)
- Test: `tests/test_ada_duplicate_warning.py`

**Interfaces:**
- Produces: `lookup` tagastuses valikuline `olemasolev: {work_id, title}`.

- [ ] **Step 1: Kirjuta kukkuv test**

Loo `tests/test_ada_duplicate_warning.py`:

```python
"""Duplikaadi hoiatus: sama handle juba imporditud. HOIATUS, mitte blokeering."""
import pytest

from server.ada import client as ada_client


def test_external_url_on_filtreeritav():
    """Ilma selleta ei saa Meilist handle'i järgi küsida."""
    from server.meili_settings import FILTERABLE_ATTRIBUTES
    assert "external_url" in FILTERABLE_ATTRIBUTES


def _peis(login):
    return {"Authorization": "Bearer {}".format(login("admin", "adminpass"))}


def _fake_lookup(monkeypatch):
    monkeypatch.setattr(ada_client, "lookup", lambda h: {
        "handle": h, "item_uuid": "u",
        "meta": {"title": "T", "external_url": "http://hdl.handle.net/10062/7822"},
        "failid": [], "kogu_baite": 0, "vahele_jaetud": [],
    })


def test_lookup_hoiatab_kui_handle_juba_olemas(client, login, monkeypatch):
    from server.routers import upload as upload_router
    _fake_lookup(monkeypatch)
    monkeypatch.setattr(upload_router, "otsi_teos_external_url_jargi",
                        lambda url: {"work_id": "abc123", "title": "Juba olemas"})
    r = client.post("/admin/ada/lookup", json={"handle": "10062/7822"},
                    headers=_peis(login))
    assert r.status_code == 200  # HOIATUS, mitte viga
    assert r.json()["ada"]["olemasolev"]["work_id"] == "abc123"


def test_hoiatus_puudub_kui_teost_ei_ole(client, login, monkeypatch):
    from server.routers import upload as upload_router
    _fake_lookup(monkeypatch)
    monkeypatch.setattr(upload_router, "otsi_teos_external_url_jargi", lambda url: None)
    r = client.post("/admin/ada/lookup", json={"handle": "10062/7822"},
                    headers=_peis(login))
    assert "olemasolev" not in r.json()["ada"]
```

- [ ] **Step 2: Jooksuta test, veendu et kukub**

Run: `.venv/bin/pytest tests/test_ada_duplicate_warning.py -v`
Expected: FAIL — `external_url` puudub `FILTERABLE_ATTRIBUTES`-ist.

- [ ] **Step 3: Lisa `external_url` filtrisse**

`server/meili_settings.py`, `FILTERABLE_ATTRIBUTES` loendisse:

```python
    "external_url",
```

**Reindeksit EI ole vaja** — väli on dokumentides juba olemas (`meili_doc.py:471`),
muutub ainult indeksi seadistus, mille `_ensure_filterable_attributes()` käivitusel
rakendab. Uuenda ka `mcp/tests/test_meili_contract.py`-d, kui see loetleb oodatud
atribuudid.

- [ ] **Step 4: Lisa otsing ja hoiatus**

`server/routers/upload.py`:

```python
def otsi_teos_external_url_jargi(url: str) -> Optional[dict]:
    """Kas see ADA kirje on juba imporditud. None = ei ole."""
    if not url:
        return None
    from ..meilisearch_ops import _meili_search
    try:
        tulemus = _meili_search({
            "q": "",
            "filter": 'external_url = "{}"'.format(url.replace('"', "")),
            "limit": 1,
            "attributesToRetrieve": ["work_id", "title"],
        })
        hits = tulemus.get("hits") or []
        if not hits:
            return None
        return {"work_id": hits[0].get("work_id"), "title": hits[0].get("title")}
    except Exception:
        # Duplikaadikontroll on mugavus. Meili maas ei tohi importi blokeerida.
        logger.warning("Duplikaadikontroll ebaõnnestus", exc_info=True)
        return None
```

ja `admin_ada_lookup`-is:

```python
    olemasolev = await run_in_threadpool(
        otsi_teos_external_url_jargi, tulemus["meta"].get("external_url") or ""
    )
    if olemasolev:
        tulemus["olemasolev"] = olemasolev
```

**Kontrollitud:** `meilisearch_ops`-is ei ole `get_index()`-i — otsingu helper on
`_meili_search(body, timeout=30)` (`meilisearch_ops.py:511`), mis teeb toore HTTP
POST-i `/indexes/{INDEX_NAME}/search` vastu.

- [ ] **Step 5: Jooksuta testid**

Run: `.venv/bin/pytest tests/test_ada_duplicate_warning.py mcp/tests/test_meili_contract.py -v`
Expected: PASS.

- [ ] **Step 6: Lisa hoiatus UI-sse ja i18n MÕLEMASSE keelde**

`AdaImportBar.tsx`-i, kokkuvõtte kohale:

```tsx
        {tulemus?.olemasolev && (
          <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm">
            <span className="text-amber-800">
              {t('ada.duplicate', { title: tulemus.olemasolev.title })}
            </span>
          </div>
        )}
```

Võti `ada.duplicate` mõlemasse `upload.json`-i.

- [ ] **Step 7: Commit**

```bash
git add server/meili_settings.py mcp/tests/test_meili_contract.py server/routers/upload.py \
        src/pages/upload/components/AdaImportBar.tsx src/locales/et/upload.json \
        src/locales/en/upload.json tests/test_ada_duplicate_warning.py
git commit -m "feat(ada): hoiatus juba imporditud handle'i kohta

external_url lisati FILTERABLE_ATTRIBUTES-i; reindeksit ei vaja, sest väli on
dokumentides olemas. Hoiatus, mitte blokeering — kordusimport võib olla tahtlik."
```

---

## Task 13: ADR 0030 ja dokumentatsioon

**Files:**
- Create: `docs/decisions/0030-page-map-lahteleht-valjundlehtedeks.md`
- Modify: `docs/decisions/README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Kirjuta ADR**

Loo `docs/decisions/0030-page-map-lahteleht-valjundlehtedeks.md`. Järgi olemasolevate
ADR-ide struktuuri (vaata `docs/decisions/0028-vutt-materialiseerib-ocr-lehed.md`).
Sisu tuum:

> **Otsus:** `_transfer_pages` kirjutab iga avaldatud lähtelehe kohta järjestatud listi
> temast materialiseeritud väljundlehtedest (`prepress.page_map[str(n)] = [out, ...]`).
> Kirjutus toimub **mõlemas** kohas, kus `out_index` kasvab. Kaart **nullitakse iga apply
> alguses**. Lähteleht, mis ei andnud ühtki väljundit, kaardis EI esine.
>
> **Miks list, mitte int:** sammu 4 `deleted` käib väljundlehe kohta. Poolitatud lähtelehe
> ühe poole kustutamine jätaks `int`-ankru kustutatud lehele, kuigi teine pool on olemas.
>
> **Tagajärg rikkumisel:** viited maanduvad valel leheküljel. Vaikselt — midagi ei kuku,
> tulemus on lihtsalt vale.

- [ ] **Step 2: Lisa ADR registrisse**

`docs/decisions/README.md` — üks rida, samas kujus nagu ülejäänud.

- [ ] **Step 3: Uuenda `CLAUDE.md`**

Kaks lisandust:

1. **Invariantide sekstiooni**, ADR 0028 ploki järele:

```markdown
**`page_map` (ADR 0030)** — `_transfer_pages` kirjutab iga avaldatud lähtelehe kohta
listi temast tekkinud väljundlehtedest, MÕLEMAS kohas kus `out_index` kasvab, ja kaart
nullitakse apply alguses. `int` ei kõlba: sammu 4 `deleted` käib väljundlehe kohta ja
poolitatud lehe ühe poole kustutamine jätaks ankru kustutatud lehele.

**Lehe JSON serveripoolsed väljad** — `editing.py` kirjutab `meta_content`-i kliendilt
TERVIKUNA üle. Uus serveripoolne lehe-väli PEAB minema `SERVERIPOOLSED_LEHE_VALJAD`-i,
muidu kaob ta esimese Ctrl+S peale, ilma vea ja logita.
```

2. **Koodi paigutuse tabelisse** (`server/` osa):

```markdown
| `ada/` | ADA (dspace.ut.ee) import: `mapping` (puhas DC-kaardistus), `client` (REST), `fetch` (allalaadimine), `provenance` (ankrud) |
```

- [ ] **Step 4: Jooksuta kõik väravad**

Run: `.venv/bin/pytest tests/ -q && npm run typecheck && npm test && npm run lint:ci`
Expected: PASS kõigis neljas.

- [ ] **Step 5: Commit**

```bash
git add docs/decisions/0030-page-map-lahteleht-valjundlehtedeks.md \
        docs/decisions/README.md CLAUDE.md
git commit -m "docs: ADR 0030 (page_map) ja ADA-mooduli kaart CLAUDE.md-sse"
```

---

## Deploy

Python-muudatus → `--no-cache` on **kohustuslik**:

```bash
# serveris
ssh vutt && cd ~/VUTT
./scripts/server_update.sh --no-cache

# lokaalses masinas
npm run build && rsync -avz --delete dist/ vutt:~/VUTT/dist/
```

`--delete` on tahtlik; `.br`/`.gz` failid PEAVAD kaasa minema.

**Suitsutest tootmises:** ava `/upload`, sisesta `10062/7822`, vajuta „Tõmba" —
vorm peab täituma ja faililoend näitama 65 faili / 322 MB.
