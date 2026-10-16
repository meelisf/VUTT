# ADR 0054 — Lehe salvestus liidab kolmesuunaliselt kliendi baasseisu vastu

**Kuupäev:** 2026-09-26
**Staatus:** vastu võetud
**Issue:** #455 · **Disain:** `docs/_archive/superpowers/specs/done/2026-09-26-lehe-kolmesuunaline-liitmine-design.md`

## Kontekst

Redaktori Ctrl+S saadab lehe `meta_content`-i tervikuna, sh kommentaarid. Vana
avatud redaktor kirjutas vahepeal lisatud kommentaarivastuse (või teise akna
salvestuse, taaste, re-OCR-i) vaikselt üle. Lehelukk (ADR 0053) järjestab
kirjutused, aga ei tea, et kliendi seis on aegunud. Redaktor laeb lehe
Meilisearchist, mis uueneb asünkroonselt — ka oma eelmise salvestuse järel võib
redaktor näidata vana seisu.

## Otsus

- `/save` võtab valikulise `base`-i: lehe väljad (`text_content`, `status`,
  `page_tags`, `comments`, `text_annotations`) nii, nagu klient need laadis või
  viimati salvestas. Server liidab lehe luku all (`_save_page_locked`)
  `server/page_merge.py` reeglitega: *mine* = *base* → *theirs*; *theirs* = *base*
  → *mine*; sama muudatus → *mine*; muidu kokkupõrge → **409**, midagi ei kirjutata.
- Üksused: **tekst + `text_annotations` koos** (ankrud elavad tekstis, ADR 0041),
  `status`, `page_tags`, kommentaarid **id kaupa**.
- Võrdlus **Meili-projektsioonis** (`read_page_view` = `meili_doc`-i lugemisloogika;
  kommentaari tekst läbi `normalize_eszett`-i; baastekst läbi sama NFC +
  marginaalia normaliseerimise nagu salvestatav tekst). Versioonihashi EI ole —
  baasi võrdlus kettaga püüab kinni ka aegunud Meili. Eelkontroll: 1000 lehel
  0 erinevust Meili ja ketta vahel.
- `base`-ita salvestus (vana bundle) kirjutab nagu varem.
- Klient: `EditorSavedState.text` on baastekst; baasi staatus tuleb Workspace
  `page.status`-ist (staatust omab Workspace). Kommentaarivastus ja kommentaari
  taaste uuendavad baasis AINULT kommentaare. Kokkupõrge → `PageConflictDialog`
  (salvesta minu / võta serveri / tühista).

## Tagajärjed

- Uus lehe väli, mida redaktor toimetab, PEAB minema `PAGE_FIELDS`-i ja
  `merge_page`-i, muidu kirjutab vana redaktor ta endiselt üle.
- `read_page_view` ja `meili_doc` lehe lugemine peavad jääma samaks projektsiooniks.
- Workspace ei neela enam salvestusvigu: `runSave` saab vea ja `isDirty` jääb.
- Valvurid: `tests/test_page_merge.py`, `tests/test_save_liitmine.py`,
  `src/components/editor/__tests__/pageConflict*.test.ts(x)`.

## Täiendus 2026-10-16: tekst ridade kaupa (#612)

Kaks toimetajat parandasid sama lehe eri ridu ja said kokkupõrke, sest tekst
oli üks üksus. Dialoog pakkus pimesi „salvesta minu", mis kirjutas teise töö üle.

- **Tekst liidetakse ridade kaupa** (`merge_text`, diff3 `difflib`-iga). Mõlema
  poole muudatus, mis kattub või **puutub** (naaberread, sama lisamiskoht), on
  kokkupõrge — nagu git. Sama rea kaks parandust põrkuvad alati.
- **`text_annotations` on eraldi üksus**, id kaupa nagu kommentaarid
  (`annotations:<id>`). Ankrud elavad tekstis, seega kontrollib `_seose_vead`
  pärast liitmist paaristägide tasakaalu ning `<annN>` ↔ kirje vastavust. Uus
  vastuolu, mida kummaski sisendis ei olnud → kogu tekst on kokkupõrge.
  Juba kettal olev orb ei ole liitmise süü.
- **409 kannab `text_chunks`** (`ok` / `conflict` tükid kogu teksti ulatuses) —
  diff arvutatakse ainult serveris; dialoog (#612 PR 2) valib tükkide kaupa.
- Liidetud tekst läbib uuesti `_normalize_page_text`-i.
- **Klient paneb liidetud teksti redaktorisse ise** (`runSave`, `ChangeSet.map`
  salvestuse ajal trükitu peale). Workspace `page` kaudu see ei jõua:
  `keepEditorText` näeb sissetulevat = salvestatud teksti ja peab redaktori sisu
  salvestamata tööks — järgmine Ctrl+S oleks teise toimetaja read üle kirjutanud.
- „Salvesta minu" tekstikokkupõrkel võtab baasi ka serveri annotatsioonikirjed:
  minu tekst võidab tervikuna, muidu jääks nende ankruta kirje orvuks.
- **Dialoog (PR 2):** tekstikokkupõrkel valitakse iga põrkuva koha juures
  tema / minu / mõlemad. 409 kannab ka `theirs_last` (lehe viimane commit).
  Kujunduskeel = ajaloo diff (`HistoryTab`): mono read, vasak värviline äär;
  värv tähistab KES (sinine tema, merevaigune sina), mitte lisatud/eemaldatud.
  Sarnases sõnas tõstetakse esile ainult erinevad tähed (u/v, ſ/s).
- **Paneel, mitte modaal:** katab ainult redaktori paani, pildipaan jääb
  suumitavaks — valikut kontrollitakse pildilt. Seetõttu ei ole Tab lõksus ja
  Esc kehtib ainult paneelis.
- Tulemus läheb redaktorisse **salvestamata**; baas = `retryBase` (konfliktsed
  üksused serveri omad), nii et Ctrl+S salvestab valiku ja muud vahepealsed
  muudatused liidetakse edasi.
- Tükkide paneelis ei ole „Salvesta minu" ega „Võta serveri versioon": viimane
  viskaks ära ka põrkumata parandused, „Kõikjal tema" teeb sama ohutumalt.
  Tükkideta juhul (staatus, kommentaar) jääb tervikvalik, nupp nimega
  „Loobu minu muudatustest".
