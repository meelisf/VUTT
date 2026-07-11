# Fable koodiülevaatuse brief — VUTT

**Kuupäev:** 2026-07-02
**Eesmärk:** kasutada Fable 5 võimekust (ligipääs kuni 7. juulini) VUTT-i **koodibaasi** kõrglennuliseks ülevaatuseks. Fikseeri tulemus püsivaks artefaktiks — leiud töötatakse hiljem tavamudeliga (Opus) läbi.

> **NB Fable'ile:** see on ülevaatuse-aken aeguva kõrgvõimekusega mudeliga. Väärtus tuleb sellest, mida sa **kirja paned**, mitte jooksvast tööst. Kirjuta leiud faili (vt Väljund), järjestatult, iga leiu juures kindlus + raskusaste + `fail:rida`.

---

## Mandaat

**1. Lai "pimealade" ülevaatus (PÕHI).**
Leia **süsteemsed pimealad, mida olemasolevad issue'd EI kata**. Ära raporteeri juba trackitud võlga (vt allpool). Fookus ristlõikavatele asjadele:
- korrektsuse lõksud, race condition'id, andmeterviklikkuse servajuhud
- operatsiooniline fragiilsus (blokeeriv I/O event-loop'is, single-worker piirid)
- veakäsitluse augud (vaikne ebaõnnestumine, neelatud erindid)
- puuduv test-kate fragiilsete kohtade ümber
- skaleerimise järsakud
- ebakõlad kahe Meilisearch-indekseerimistee vahel
- turvaservad (vt ka osa 2)

**2. Turva-delta (TEISEJÄRGULINE).**
Eelmine Fable turvaülevaatus on tehtud ja parandused olemas (`tests/test_security_fixes.py`, `test_production_secrets.py`, `test_login_throttle.py`, `test_session_invalidation.py`). **Ära korda tervikülevaatust** — fokusseeru **muutunud pinnale**: uued OCR-jobs / admin endpointid, upload-tee, hiljutised commitid (vt allpool). Otsi regressioone ja uut rünnakupinda.

---

## Mis on JUBA TEADA — ära raporteeri uuena

### Avatud issue'd (tehniline võlg, juba trackitud)
- **#89 (P1):** `TextEditor.tsx` / `Dashboard.tsx` / `WorkManage.tsx` + `workApi.ts` tükeldamine
- **#88 (P2):** taustatööde health/status endpoint puudub
- **#87 (P2):** otsingu debounce + AbortController (Meili päringud)
- **#73 (P2):** prosopography `_legacy_ops` compatibility-kihi eemaldamine
- **#65 (P1):** `server/upload_ops.py` tükeldamine
- **#63 (P2):** upload safety guardrails ilma lehekülgede arvu piiranguta

### Dokumenteeritud invariandid & intsidendid (kehtivad, ära "avasta" neid vigadena)
- **Async blokeering (intsident 2026-06-13):** `async def` endpoint EI TOHI kutsuda blokeerivat I/O-d (SSH jms). Single-worker uvicorn event-loop külmus → saidiülene rippumine. Parandatud. → *Kui leiad UUE blokeeriva I/O `async def`-is, see on küll raporteeritav.*
- **VuttMarkupExtension (CodeMirror):** `RangeSetBuilder.add()` nõuab `from ASC`, sama `from` korral `to ASC`; replace-dekoratsioonid EI TOHI kattuda (`lastReplaceEnd`), mark'id VÕIVAD; `vuttTagProtectionFilter` peab jääma extension-listi viimaseks. Need on teadlikud disainireeglid.
- **Meilisearch kaks indekseerimisteed:** `server/meilisearch_ops.py` (live) + `scripts/1-1_consolidate_data.py` (seed). Loogika peab olema MÕLEMAS, muidu reseed regresseerub. → *Ebakõla kahe tee vahel on väärtuslik leid.*
- **Meili skeem:** eestikeelsed väljanimed (legacy: `genre_et`, `type_ids` jne). `*_object` väljad AINULT Meili-dokumentides, mitte `_metadata.json`-is. `work_id` peab olema KÕIGIS dokumentides.
- **Meili cold-start:** `prefixSearch: "indexingTime"` + keep-warm loop teadlik. `prefixSearch: "disabled"` EI SOBI (typo-tolerants katkeks).
- **Auth-degradatsioon:** `LoginModal` `isOpen` EI TOHI KUNAGI siduda `sessionExpired`-iga (lõksib avaliku vaate kasutaja). Varajase vea-`return`-iga komponentides peavad modaalid olema monteeritud MÕLEMAS harus.
- **Kirjutustee:** kõik `_metadata.json` uuendused läbi `save_work_metadata()` (`server/metadata_ops.py`).
- **Kataloogid:** `data/config/` (git, `/data/config` Dockeris, `VUTT_DATA_DIR`) = konfiguratsioon; `state/` (`/app/state`, runtime) = `users.json`, sessioonid, `user_settings/`. Nende segiajamine on klassikaline viga — kontrolli teekonstante.
- **Marginaalia normaliseerimine** toimub AINULT salvestamisel (`server/marginalia_normalize.py`), mitte elavalt.
- **Dashboard** laeb KÕIK teosed korraga (`limit: 5000`) — server-side pagineerimine lõhuks filtriloogika (teadlik).
- **Python 3.9 compat:** `dict | None` → `Optional[dict]`.
- **Skaleerimine (teadlik TODO):** single-worker uvicorn; gunicorn + Redis alles plaanis (>500 kasutajat). Ära raporteeri "lisa gunicorn" — küll aga konkreetsed GIL/mälukoha ohud.

---

## Repo hetkeseis (orienteerumiseks)

### Suurimad backend-failid (`server/`, ridade arv)
```
1958  server/prosopography/_legacy_ops.py   (eemaldamisel — issue #73)
1640  server/upload_ops.py                   (tükeldamisel — issue #65)
1047  server/admin_page_ops.py
 906  server/git_ops.py
 829  server/prosopography/router.py
 718  server/prosopography/places_ops.py
 711  server/reocr_ops.py
 686  server/meili_doc.py
 614  server/meilisearch_ops.py
 574  server/prosopography/person_search.py
 572  server/prosopography/enrichment.py
 538  server/prosopography/person_crud.py
```

### Suurimad frontend-failid (`src/`, ridade arv)
```
1208  src/components/editor/AnnotationsTab.tsx
1115  src/pages/Dashboard.tsx                (tükeldamisel — issue #89)
1089  src/pages/WorkManage.tsx               (tükeldamisel — issue #89)
 963  src/prosopography/pages/PersonEditPage.tsx
 943  src/pages/Review.tsx
 938  src/components/MetadataModal.tsx
 907  src/components/PageImageEditorModal.tsx
 856  src/prosopography/pages/PersonDetailPage.tsx
 565  src/components/editor/MarginaliaExtension.ts
```

### Test-kate
- Python: **75** test-faili (`tests/test_*.py`)
- Frontend: **44** test-faili (`*.test.ts(x)`)
- → Puuduva katte leiud on väärtuslikud EELKÕIGE fragiilsete kohtade ümber (redaktor, marginaalia, Meili-sync, OCR-recovery, auth).

### Hiljutine töö (turva-delta fookus — muutunud pind)
Viimased commitid keskenduvad ühtsele OCR-tööde vaatele ja recovery-hardening'ule:
- `GET /admin/ocr/jobs` — ühtne OCR-tööde endpoint (upload + re-OCR + batch)
- `normalize_ocr_jobs`, `list_reocr_batch_jobs`
- upload deep-link `?resumeUpload=`
- upload creatori username
- batch-orbude taaste (reaper, mapping-fail)
→ Kontrolli neid uusi endpointe autoriseerimise, sisendivalideerimise ja info-lekke osas.

---

## Väljund

Kirjuta **kaks eraldi faili**:
1. `docs/reviews/2026-07-02-fable-blindspots.md` — pimealade-ülevaatus
2. `docs/reviews/2026-07-02-fable-security-delta.md` — turva-delta

Iga leid:
- **Pealkiri** (üks lause)
- **Fail:rida** (kus võimalik)
- **Raskusaste:** kriitiline / kõrge / keskmine / madal
- **Kindlus:** kindel / tõenäoline / spekulatiivne
- **Uus vs trackitud:** kas kattub olemasoleva issue'ga
- **Stsenaarium:** konkreetne sisend/olek → vale tulemus/krahh
- **Soovitus** (lühidalt)

Järjesta **raskusaste × kindlus** järgi, kõige tõsisemad ette.

---

## Fable käivitusnõuanded (kui ise ette söödad)

- **Effort:** `high` või `xhigh` — pikaajaline agentne uurimine, kus Fable on tugevaim.
- **Coverage-first:** raporteeri KÕIK leiud (ka madala kindlusega), ära ise filtreeri "olulisuse" järgi — triaaž toimub hiljem. Nii ei kao päris-bugid maha.
- **Anna kogu spetsifikatsioon ette** (see fail) ühe korraga, mitte tükkhaaval.
- **Põhjus (Fable'ile motivatsiooniks):** VUTT on ~300 samaaegse kasutaja jaoks optimeeritud eesti varauusaegse teksti transkriptsiooni-tööriist; andmed on serveril ja väärtuslikud; regressioon või andmeleke on kallis. Eesmärk on leida see, mis on kahe silma vahele jäänud, enne kui koormus kasvab.
